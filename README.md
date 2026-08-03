# cairns

A repo-native task board that doubles as memory for coding agents.

A cairn is a stack of stones left on a route so the next person through knows the
way — including where the trail does not go.

> Status: v0.0.2 — an early release. The CLI, the interactive board and the
> rendered board page work end to end, but the interface is still settling.
> Expect breaking changes.
>
> Upgrading from 0.0.1 needs `cairn init --hooks` in each repo: the hook set
> gained `post-merge` and `.gitattributes` gained rules for the board page.

## The idea

Solo developers working alongside coding agents do not mostly suffer from "what
should I do next." They suffer from the agent re-deriving the same context every
session and walking into the same dead ends.

So cairns is not a small Jira. It is a set of markdown files in `.tasks/` that
record why — decisions, their reasons, and the approaches that failed — versioned
by git, greppable by an agent, and never leaving the repo.

The payoff looks like this:

```
$ cairn related src/middleware.ts
src/middleware.ts

t-2dq51jfb8z closed 2026-08-01  Replace session cookie with JWT
  outcome: JWT signed with the existing KMS key; verification moved out of
    middleware into the route handler.
  ⚠ dead end: middleware-based verification broke SSR streaming because
    middleware runs after the response flushes
  ⚠ dead end: JWT verification fails intermittently under load
    mechanism: unknown
```

When nothing matches, it says so out loud — and, if the commit hooks are missing
from your clone, it tells you the result means "unknown" rather than "nothing".

An agent about to edit that file gets the specific dead end that cost you an
afternoon. No hosted tracker can do that, because it does not live in your repo.

## How it holds together

Findings are recorded as mechanisms, not verdicts. "Middleware runs after the
response flushes" can be rechecked; "middleware doesn't work" goes stale
invisibly.

Live truth is separated from evidence. A short, capped notes block is loaded every
session. The append-only log is never auto-loaded — it is searched on purpose,
because a stale claim injected into context gets treated as current fact. Notes
are hand-written and unverified, and nothing tells a model to trust them over its
own reading of the code.

Links to code are derived from git rather than maintained by hand, via a commit
trailer written by a hook you never think about. The hook has to know which task
you are on, so it reads the active task and falls back to the branch name — and
when it can find neither it says so on the commit instead of skipping quietly.
For commits already made without it, `cairn link` recovers the file list and
reports it as a backfill, never as something git vouched for.

Context cost is fixed and small. Everything that loads by default is capped, so
the board does not get more expensive as the backlog grows.

## Install

Not published yet. From a clone:

```sh
bun install
bun run build
node dist/cli.js --help
```

## Use

```sh
cairn init                     # create .tasks/, install hooks, write the protocol
cairn context                  # the fixed session-start load — run this first
cairn add "<thought>"          # two-second capture

cairn start <id>               # commits now carry a `Task:` trailer
cairn log "decided: <what> because <why>"
cairn log "dead end: <what failed> because <mechanism>"
cairn ask "<question>"         # surfaces in context until answered
cairn done <id> --outcome "…"  # refuses to close without one

cairn search <term>            # ranked across logs and closed tasks
cairn related <path>           # what to know before editing this file
cairn link <id> <rev>…         # recover the file list from commits made without it
cairn board                    # interactive board
cairn render                   # write .tasks/README.md, which renders on a git host
```

A `decided` or `dead end` entry is refused unless it carries a mechanism. If you
genuinely do not know it, `--mechanism unknown --evidence "<pasted error>"` is
accepted — honest vagueness beats a confident guess.

### Getting back out

`cairn init` writes into files you own, so everything it writes is marked:

| File | Marker |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | `<!-- cairns:begin v1 -->` … `<!-- cairns:end -->` |
| `.git/hooks/*` | `# cairns:hook v2` |
| `.gitattributes` | `# cairns:attributes` |

```sh
cairn uninstall            # drops the marked blocks; the board stays
cairn uninstall --purge    # also deletes .tasks/
```

Removal is surgical: your own rules in those files are left alone, a hook that
cairns chained is restored from its `.pre-cairns` backup, and a hook without the
marker is reported and never touched. `.tasks/` survives by default because the
board is the accumulated memory, not the plumbing.

## The board

`cairn board` is a zero-dependency terminal UI over the same files.

```
cairns /repo                                              ▶ t-2dq51jhn9d
──────────────────────────────────────────────────────────────────────────
 ▶ t-2dq51jhn9d  KMS key rotation                                      1·
 ○ t-2dq5kjbznn  Audit token expiry handling
 ✓ t-2dq51jfb8z  Replace session cookie with JWT                2✗ 1? 5·
```

`n` new · `s` start · `e` log · `E` edit in `$EDITOR` · `D` close · `/` search ·
`r` related · `?` help. The badges count dead ends, open questions and log
entries. The mechanism rule is enforced here too.

## On a git host

`cairn render` writes `.tasks/README.md`, and a git host renders a directory's
README under its file listing — so clicking `.tasks/` on GitHub shows the board
with open work, open questions, recorded dead ends and closed outcomes, each id
linking to its task file.

It is the one derived file cairns commits, which takes some care:

- The page is a pure function of `.tasks/`. No timestamp, no clock, nothing
  asked of git — so every clone renders the same bytes and a diff means the
  board actually changed.
- `.gitattributes` routes it to a merge driver that keeps one side rather than
  producing a conflict in a generated file, and the `post-merge` hook re-renders
  once the working tree is whole. A merge driver cannot do that job itself: git
  runs them before the rest of the merged tree lands, so it would render a tree
  that is not there yet.
- `cairn render --check` exits non-zero when the page is stale. That is the CI
  form; a workflow that commits the page back races your own push.

```sh
cairn render                   # write it
cairn render --check           # fail if stale
cairn render --stdout          # pipe it somewhere else
```

## Not this

No web UI, no server, no hosted anything. No assignment, sprints, or estimation.
No replacement for your existing `docs/plans` convention — it adapts to wherever
plans already land.

## Design

`DESIGN.md` is the full specification: file format, the notes-versus-log split,
context budget and retrieval rules, plan staleness and archival, code linking, the
agent protocol, MVP scope, and the ideas that were explicitly rejected.

Some load-bearing choices:

- **Ids are time-ordered random tokens**, not ordinals. Two agents capturing a
  task in the same second must not be able to allocate the same id and have git
  merge one over the other.
- **The log is append-only NDJSON** with `merge=union`, so concurrent writers
  produce the union of both sets rather than a conflict.
- **The frontmatter parser never throws.** An absent field is a default, and
  unknown fields survive a rewrite byte-for-byte — an older binary must not eat a
  newer field.
- **The index is a cache, never a source of truth.** It is gitignored, and every
  query returns the same answer without it, just slower.
- **`cairn context` degrades instead of failing.** It truncates to a budget and
  always exits zero, because a session-start command that errors leaves the agent
  with no context at all.

## License

MIT
