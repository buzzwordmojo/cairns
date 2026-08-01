const ESC = "\u001b";
const SGR = /\u001b\[[0-9;]*m/g;

/** Length as the terminal sees it — colour codes occupy no cells. */
export function visLen(s: string): number {
  return s.replace(SGR, "").length;
}

export function clip(s: string, width: number): string {
  if (width <= 0) return "";
  if (visLen(s) <= width) return s;
  let out = "";
  let vis = 0;
  let i = 0;
  while (i < s.length && vis < width - 1) {
    if (s[i] === ESC) {
      const m = /^\u001b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += s[i];
    i++;
    vis++;
  }
  return `${out}…${ESC}[0m`;
}

export function pad(s: string, width: number): string {
  const n = width - visLen(s);
  return n > 0 ? s + " ".repeat(n) : clip(s, width);
}

export interface Key {
  name: string;
  ch: string;
  ctrl: boolean;
}

const NAMED: Record<string, string> = {
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[H": "home",
  "[F": "end",
  "[5~": "pageup",
  "[6~": "pagedown",
  "OA": "up",
  "OB": "down",
  "OC": "right",
  "OD": "left",
};

/** Decodes a raw-mode chunk. A lone ESC is `escape`; paste arrives as many keys. */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === ESC) {
      const rest = chunk.slice(i + 1);
      const seq = Object.keys(NAMED).find((k) => rest.startsWith(k));
      if (seq) {
        keys.push({ name: NAMED[seq]!, ch: "", ctrl: false });
        i += seq.length + 1;
        continue;
      }
      // An unrecognised CSI is swallowed whole rather than leaking its bytes
      // into a text prompt as garbage characters.
      const csi = /^\[[0-9;?]*[A-Za-z~]/.exec(rest);
      if (csi) {
        i += csi[0].length + 1;
        continue;
      }
      keys.push({ name: "escape", ch: "", ctrl: false });
      i += 1;
      continue;
    }
    const c = chunk[i]!;
    const code = c.charCodeAt(0);
    if (c === "\r" || c === "\n") keys.push({ name: "enter", ch: "", ctrl: false });
    else if (c === "\t") keys.push({ name: "tab", ch: "", ctrl: false });
    else if (code === 127 || code === 8) keys.push({ name: "backspace", ch: "", ctrl: false });
    else if (code < 32) keys.push({ name: String.fromCharCode(code + 96), ch: "", ctrl: true });
    else keys.push({ name: c, ch: c, ctrl: false });
    i += 1;
  }
  return keys;
}

export interface Host {
  /** Hands the terminal to a child process, then takes it back. */
  suspend(fn: () => void): void;
}

export interface App {
  attach?(host: Host): void;
  render(width: number, height: number): string[];
  /** Return false to exit the loop. */
  onKey(key: Key): boolean;
}

export class Screen {
  private started = false;
  private lastFrame = "";

  get width(): number {
    return process.stdout.columns || 80;
  }

  get height(): number {
    return process.stdout.rows || 24;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Alt screen first, so the user's scrollback is never touched.
    process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J`);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`${ESC}[?25h${ESC}[?1049l`);
  }

  paint(lines: string[]): void {
    const { width, height } = this;
    const rows: string[] = [];
    for (let i = 0; i < height; i++) rows.push(`${clip(lines[i] ?? "", width)}${ESC}[K`);
    const frame = `${ESC}[H${rows.join("\r\n")}`;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    process.stdout.write(frame);
  }

  invalidate(): void {
    this.lastFrame = "";
  }
}

/**
 * Owns the terminal for the duration of the app. The restore path runs on every
 * exit route — clean return, thrown error, SIGINT, SIGTERM — because a process
 * that dies in raw mode on the alt screen leaves the user with a dead shell.
 */
export function run(app: App): Promise<number> {
  const screen = new Screen();

  return new Promise<number>((resolve, reject) => {
    let done = false;

    const finish = (code: number, err?: unknown) => {
      if (done) return;
      done = true;
      screen.stop();
      process.stdin.off("data", onData);
      process.stdout.off("resize", onResize);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.stdin.pause();
      if (err) reject(err);
      else resolve(code);
    };

    const draw = () => {
      if (done) return;
      screen.paint(app.render(screen.width, screen.height));
    };

    function onData(chunk: string) {
      try {
        for (const key of decodeKeys(chunk)) {
          if (done) return;
          if (key.ctrl && key.name === "c") return finish(0);
          if (!app.onKey(key)) return finish(0);
        }
        draw();
      } catch (err) {
        finish(1, err);
      }
    }

    function onResize() {
      screen.invalidate();
      draw();
    }

    function onSignal() {
      finish(0);
    }

    const suspend = (fn: () => void) => {
      // The child needs the tty to itself: raw mode off, our reader detached,
      // and the alt screen dropped so an editor gets a normal terminal.
      process.stdin.off("data", onData);
      screen.stop();
      try {
        fn();
      } finally {
        screen.start();
        screen.invalidate();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", onData);
        draw();
      }
    };

    try {
      app.attach?.({ suspend });
      screen.start();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      process.stdout.on("resize", onResize);
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      draw();
    } catch (err) {
      finish(1, err);
    }
  });
}
