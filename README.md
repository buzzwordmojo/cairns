# cairns

A repo-native task board that doubles as memory for coding agents.

A cairn is a stack of stones left on a route so the next person through knows the
way — including where the trail does not go.

> Status: design stage. `DESIGN.md` is complete, no code has been written yet.
> Nothing here is installable.

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

t-042 closed 2026-08-04  Replace session cookie with JWT
  ⚠ dead end: auth cannot run here — middleware executes after the
    response flushes.  log-2, 2026-08-01
t-039 closed 2026-06-11  KMS key rotation
  note: rotation tooling assumes the key alias, not the key id.

2 open tasks target this file: t-051, t-055
```

An agent about to edit that file gets the specific dead end that cost you an
afternoon. No hosted tracker can do that, because it does not live in your repo.

## How it holds together

Findings are recorded as mechanisms, not verdicts. "Middleware runs after the
response flushes" can be rechecked; "middleware doesn't work" goes stale
invisibly.

Live truth is separated from evidence. A short, capped, human-owned constraints
block is loaded every session. The append-only log is never auto-loaded — it is
searched on purpose, because a stale claim injected into context gets treated as
current fact.

Links to code are derived from git rather than maintained by hand, via a commit
trailer written by a hook you never think about.

Context cost is fixed and small. Everything that loads by default is capped, so
the board does not get more expensive as the backlog grows.

## Not this

No web UI, no server, no hosted anything. No assignment, sprints, or estimation.
No replacement for your existing `docs/plans` convention — it adapts to wherever
plans already land.

## Design

`DESIGN.md` is the full specification: file format, the constraints-versus-log
split and its promotion gate, context budget and retrieval rules, plan staleness
and archival, code linking, the agent protocol, MVP scope, and the ideas that were
explicitly rejected.

## License

MIT
