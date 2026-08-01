export interface Args {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Hand-rolled so the package keeps zero runtime dependencies. */
export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (passthrough) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      passthrough = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (body.startsWith("no-")) {
        flags[body.slice(3)] = false;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
      for (const ch of arg.slice(1)) flags[ch] = true;
      continue;
    }
    positional.push(arg);
  }

  return { positional, flags };
}

export function flagString(args: Args, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = args.flags[n];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function flagBool(args: Args, name: string, fallback = false): boolean {
  const v = args.flags[name];
  return typeof v === "boolean" ? v : v === undefined ? fallback : v !== "false" && v !== "0";
}

export function flagNumber(args: Args, name: string, fallback: number): number {
  const v = flagString(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function flagList(args: Args, ...names: string[]): string[] {
  const raw = flagString(args, ...names);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
