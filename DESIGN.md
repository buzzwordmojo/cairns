# cairns — design

A cairn is a stack of stones left on a route so the next person through knows the
way, including where the trail does not go. That is what this package leaves in a
repository.

Package name `cairns` on npm. Command is `cairn`.

Status: design only. No code yet.

---

## 1. Thesis

A dependency-free package that bolts into any repository and provides a small,
local, git-native project board made of markdown files.

It is not competing with Jira, Trello, Linear, or ClickUp. It is aimed at solo
developers working alongside coding agents, where the actual pain is not "what
should I do next" but that the agent re-derives the same context every session and
walks into the same dead ends.

The insight the whole design rests on: the board is agent memory, not a task list.
Hosted trackers record status. This records why — decisions, their reasons, and
the approaches that failed. That record lives next to the code, is greppable by an
agent, and is versioned by git.

The product is really three things in order of importance:

1. A file format for durable findings attached to work.
2. A protocol that tells any agent in the repo how to read and write it.
3. A CLI, which is almost incidental.

## 2. Non-goals

- No web UI, no server, no hosted anything. State outside git is state that rots.
- No multi-user workflow, assignment, sprints, velocity, or estimation.
- No replacement for existing plan and spec conventions. Adapt to them.
- No symbol-level or AST-level code analysis.

## 3. Core concepts

Four objects, with deliberately different trust levels and lifetimes.

| Object | Lifetime | Written by | Loaded by default |
|---|---|---|---|
| Task | Long, spans sessions | Human and agent | Active task only |
| Constraint | Until falsified | Human only | Yes |
| Log entry | Permanent, append-only | Agent and human | No |
| Plan | One work session | Harness or agent | No, pointer only |

The separation between constraints and log entries is the most important idea in
the design and is covered in section 5.

## 4. The task file

One file per task under `.tasks/`. File-per-task rather than a single board file,
because a single file conflicts constantly the moment you and an agent both write
to it, and it stops being loadable past roughly fifty tasks.

Each file splits into a small head that is rewritten and a larger tail that is
append-only. Models are unreliable at editing prose in place — they bloat it and
drop things — but they are reliable at appending a dated entry.

```markdown
---
id: t-042
title: Replace session cookie with JWT
status: doing
created: 2026-08-01
updated: 2026-08-01
targets: [src/auth/session.ts, src/middleware.ts]
plan:
  path: docs/plans/jwt-session.md
  stamped: 4a91c02
---

## Done when
- Existing sessions survive deploy without forced logout
- No auth call in the SSR render path

## Context
Sessions are read on every SSR render, which is why the dashboard is slow.

## Constraints
- Auth cannot run in middleware — it executes after response flush.
  since 2026-08-01 · from log-2 · recheck-if: next major upgrade

## Open questions
- Do we need refresh-token rotation for v1, or defer? (needs Bob)

## Log
- 2026-08-01 · agent · decided: sign with the existing KMS key rather than a
  new secret, because rotation tooling already exists for it.
- 2026-08-01 · agent · dead end: middleware-based verification broke SSR
  streaming — the response is already flushed when middleware runs.
```

Four sections earn their place and nothing else does.

Done when is the highest-value field and the one every ad-hoc todo system omits.
An agent without acceptance criteria guesses at completion, which is exactly where
you get a confident "all set" on unfinished work. Two or three testable lines,
written before work starts.

Dead ends are the compounding asset. Negative results are the most expensive
information in a project and the least recorded — the failed approach cost an
afternoon and lives nowhere. Every one captured is an afternoon not burned again
in three months.

Open questions give the agent somewhere to put uncertainty other than a guess. If
the format has a slot for "I need a human here," models will use it.

Targets in the frontmatter is what makes reverse lookup work, per section 8.

### Rule: mechanism, not verdict

"Middleware does not work" is a verdict. It goes stale invisibly and nothing ever
challenges it. "Middleware runs after the response flushes" is a mechanism —
falsifiable, and checkable in thirty seconds. Every decided or dead-end entry must
carry a because clause, enforced by the CLI at write time rather than by hoping.
An entry that cannot state a because is a symptom, not a finding.

### Rule: nothing git already knows

No status narration, no "finished the refactor," no restating the diff. If git can
answer it, it does not go in the log.

## 5. Constraints versus log, and the promotion gate

### The risk

Models treat text in their context as ground truth. They do not natively discount
a stale claim and rarely go verify one. So a wrong entry written in August is read
as prior fact in October, acted on, and then restated in a new entry — now it has
two apparent sources and looks corroborated. Errors compound faster than truths
because nothing in the system challenges them.

This is the central failure mode of the whole design. Verbosity was never the
risk; poisoning is.

### The split

The log is agent-writable, append-only, dated, attributed, and never auto-loaded.
Constraints are human-gated, always loaded, and hard-capped at seven per task and
fifteen per project.

The cap is load-bearing. Once at cap, adding requires removing, which forces the
triage that otherwise never happens. An uncapped constraints block becomes a
second log within a month.

A constraint carries three obligations: what is true, when it became true, and
what would make you recheck it.

```
- Auth cannot run in middleware — it executes after response flush.
  since 2026-08-01 · from log-2 · recheck-if: next major upgrade
```

The recheck trigger is the anti-rot mechanism. Most stale constraints are stale
because a dependency moved, and naming the dependency makes staleness detectable
instead of invisible. A constraint nobody can write a recheck trigger for is
usually a verdict in disguise and belongs in the log.

Scope splits two ways: task-local constraints live in the task file, repo-wide
ones in `.tasks/CONSTRAINTS.md`.

### The gate

An agent with write access can always edit a constraints block directly, so this
cannot be prevented — only made loud. A hash of the block lives in frontmatter,
verified by the CLI and a pre-commit hook. Any change without a matching promotion
record fails with the diff printed. Detection, not prevention, is the achievable
goal.

### Nomination

Agents cannot promote, but they can nominate. `cairn nominate <id> <log-id>` drops
an entry in a queue, and `cairn review` walks the human through accept, edit, or
reject. Without this the human never remembers to promote, constraints stay empty,
and the design collapses back into a plain log. The pending count appears in
status output, and unreviewed nominations expire back into the log after two weeks
— nothing is lost, it just does not get authority by default.

### Demotion

When a constraint is falsified it moves back down to the log as a superseded
entry carrying the date it stopped being true. Never deleted, or you lose the
record of why you ever believed it and will rediscover the same wrong belief.

## 6. Context budget and retrieval

A fixed, small, predictable cost at session start. Everything capped upstream pays
off here: because constraints are capped and Done when is three lines, the ceiling
is real rather than hoped for.

### Default load

`cairn context`, roughly one thousand tokens:

```
CONSTRAINTS (project)
- Node 18 in prod, no native ESM in workers. since 2026-05-02
- Mobile client frozen this quarter. since 2026-07-14
  ⚠ recheck-if: after Q4 release

ACTIVE  t-042  Replace session cookie with JWT
  done when: sessions survive deploy; no auth in SSR render path
  constraints: auth cannot run in middleware (runs after flush)
  open question: refresh-token rotation in v1? (needs Bob)
  targets: src/auth/session.ts, src/middleware.ts

OPEN (6)  t-039 KMS key rotation · t-044 dashboard perf · …

11 closed tasks touch these files. Run `cairn search <term>` before
proposing an approach.
```

The backlog index is one line per task so the agent knows the shape of the work
without paying to read it.

That closing nudge is doing more work than it looks. A retrieval layer the agent
never thinks to call is dead weight, so the default context must advertise what is
retrievable and when to reach for it. Without it, agents confidently reinvent a
dead end sitting one command away.

### On demand

- `cairn show <id>` — full task including log
- `cairn log <id>` — log only
- `cairn search <term>` — across logs and closed tasks
- `cairn related <path>` — reverse lookup by file

### Three rules that keep retrieval from undoing section 5

1. Every retrieved line carries date, author, and task id inline. Strip metadata
   to save tokens and you hand the model an undated claim it will treat as
   current fact.
2. Search returns ranked and truncated results, ten by default. A search that
   dumps forty log lines has auto-loaded the log through the back door.
3. Compacted outcomes of closed tasks rank above raw attempt lines, so the agent
   sees how something ended before it sees what was tried.

### Freshness

When a constraint's recheck trigger has fired — the named dependency moved in the
lockfile — mark it visibly as possibly stale in the default view rather than
presenting it as settled. This is the one place automation genuinely helps,
because nobody manually audits constraints.

### Budget enforcement

If `cairn context` exceeds its ceiling it says which cap was violated instead of
quietly emitting three thousand tokens. Predictable cost is the feature. A board
whose context load grows with backlog size gets uninstalled.

## 7. Compaction

A task file past roughly two hundred lines has stopped being loadable context and
become a landfill. When a task closes it distills to a few lines of outcome, and
anything with a life beyond the task graduates to a constraint or a decision
record. Without this rule the design rots in about four months.

## 8. Plans

### There is no standard

Survey of one real machine found `docs/plans/` as the dominant convention, plus
`docs/specs/`, `.auto-claude/specs/`, a bare `plan/`, and eleven `FEATURE_PLAN_*.md`
files loose at a repo root. Claude Code's plan mode does not persist to disk by
default. So this is a widely-shared habit with real drift, not a spec to conform
to — which argues for adapting to wherever plans already land.

### Goal versus route

Acceptance criteria are durable. They survive every rewrite of the approach and
belong to the task. Step lists are disposable, valid only against the code as it
stood when written, and belong to the plan. Most plan files conflate the two,
which is why they cannot be thrown away and therefore pile up.

### Why stale plans are worse than stale log entries

A plan is imperative. A dead-end entry says "X failed" and a model can weigh it. A
plan says "do X" and a model in context will start doing it.

### Stamping

The stamp lives in task frontmatter, never inside the plan file, because the
harness owns that file and may regenerate it. The task holds path, the SHA it was
written against, and the target files.

The staleness signal is git drift on those targets between stamp and HEAD.
Deterministic, free, requires cooperation from no one. Report facts rather than
computing a verdict — "3 of 4 target files changed across 12 commits since this
plan was written." A staleness percentage would be exactly the kind of verdict the
log is forbidden from writing, and would be wrong in both directions.

### No step tracking

Checkbox state depends on agent discipline and drifts silently, which is worse
than no signal. Instead, when a plan is pulled, print it alongside the diff of its
targets since the stamp and let the model reconcile what already landed. Fuzzy,
but honestly fuzzy, and free to maintain.

### Archival

Git is already the archive. On task close the plan distills into a log entry and
the file is deleted from the working tree. Nothing is lost — `git show` retrieves
it forever — and removing it from the tree is the entire objective, since the
danger was an agent reading instructions that no longer apply. Same for a plan
replaced mid-task: delete, and log why.

### Orphan sweep

`cairn plan sweep` finds plan files referenced by no open task and offers to
archive them in one pass. This is the adoption hook: point it at an existing repo
and the repo immediately gets quieter, before a single task has been created.

## 9. Code linking and reverse lookup

Asking a human or an agent to maintain a file list guarantees rot. Derive the link
from git instead.

### Task to code

`cairn start t-042` records the active task, and a `prepare-commit-msg` hook
appends a `Task: t-042` trailer to every commit while it is active. The developer
never types it. The file list is then a query, not stored state:

```
git log --grep="Task: t-042" --name-only
```

Two fields with different meanings, never merged: `targets` is intent, written at
creation, useful before any commit exists. `touched` is record, derived from git,
always accurate. Conflating them is how the list rots.

### Code to task

`TODO(t-042)` markers are supported but optional, and the annotation-free path is
the default. Many people will not accept task ids sprinkled through their source.
Where markers are used, `cairn done` greps for references to the closing task and
warns about orphans — detection, same posture as the constraints hash.

### Reverse lookup

The most valuable output in the product. The question is "what do I need to know
before editing this file."

```
$ cairn related src/middleware.ts

t-042 closed 2026-08-04  Replace session cookie with JWT
  ⚠ dead end: auth cannot run here — middleware executes after the
    response flushes.  log-2, 2026-08-01
t-039 closed 2026-06-11  KMS key rotation
  note: rotation tooling assumes the key alias, not the key id.

2 open tasks target this file: t-051, t-055
```

An agent about to modify that file gets the specific dead end that cost an
afternoon — retrieved on purpose, dated, attached to a mechanism. No hosted
tracker can produce this, because it does not live in the repo.

### Implementation notes

File-level granularity only. Function-level links break on the first refactor and
need a parser per language; file paths are language-agnostic and git's rename
detection carries them across moves.

The path-to-task index is cached in a gitignored file rebuilt by a post-commit
hook. Scanning full history per query gets slow on a large repo. Derived state is
never committed, or the board invents a new class of merge conflict.

## 10. The agent protocol

`cairn init` appends a versioned block to CLAUDE.md or AGENTS.md, detecting which
the repo already uses and appending rather than overwriting.

The binding constraint is that this loads in every session in that repo, so it
competes for the same budget sections 6 and 7 exist to protect. Under fifty lines
or it is self-defeating. Written for a model: imperative, with a short because
clause only where compliance depends on understanding the reason.

```markdown
## Task board protocol

Work in this repo is tracked in `.tasks/`. Those files are the source of
truth for what is being built and why.

### Starting work
Run `cairn context`. It prints project constraints, the active task, and
the open backlog. Constraints are authoritative and current — trust them
over your own inference about this codebase.

### Before proposing an approach
Run `cairn search <term>`. Prior attempts and dead ends are recorded
there. Do not propose an approach the log records as failed unless you
state why the recorded reason no longer applies.

### While working
Append findings as you get them, not at the end:
  cairn log <id> "decided: <what> because <why>"
  cairn log <id> "dead end: <what failed> because <mechanism>"
  cairn log <id> "note: <fact discovered>"

- State the mechanism, not the verdict. Write "middleware runs after the
  response flushes", not "middleware doesn't work". Verdicts go stale
  invisibly; mechanisms can be rechecked.
- If you cannot state a because, you have a symptom, not a finding.
- Never log status narration. Git already records what changed.
- One entry per finding.

### Finishing
A task is done when every line under "Done when" is verifiably true. If
you cannot verify a line, say so instead of marking it done.
  cairn done <id> --outcome "<what shipped; what a future reader needs>"

### Never
- Do not edit a Constraints block. It is hash-verified and a direct edit
  fails the pre-commit hook. Propose instead:
  `cairn nominate <id> <log-id>`
- Do not delete or rewrite log entries. Overturn instead:
  `cairn log <id> "supersedes <log-id>: <what is true now> because <why>"`
- Do not open a task for work you will finish this session.

### Uncertainty
If you need a human decision, do not guess:
  cairn ask <id> "<question>"
The question appears in default context until answered.
```

Two rules will be violated most: searching before proposing, and not narrating
status. Instruction alone will not hold either. The search nudge is embedded in
the context output, and the log command rejects decided or dead-end entries with
no because clause. Enforcement in code beats enforcement in prose — the protocol
should only carry rules the CLI cannot check.

The Never section is the most valuable part, because those are the failures that
silently corrupt the record rather than merely producing mess.

## 11. MVP scope

Seven commands and nothing else.

| Command | Does |
|---|---|
| `cairn init` | Create `.tasks/`, append protocol block, install git hooks |
| `cairn add "<thought>"` | Two-second capture into the backlog |
| `cairn context` | The fixed default load |
| `cairn start <id>` / `cairn done <id>` | Status, commit trailer, outcome capture |
| `cairn log <id> "..."` | Append a finding, because-clause validated |
| `cairn search <term>` | Retrieval across logs and closed tasks |
| `cairn related <path>` | Reverse lookup |

Build `search` and `related` first, not last, even though they are normally the
polish. They are the whole bet: if reverse lookup never surfaces something you had
forgotten, the memory thesis is wrong and this is just another todo list.

Capture matters more than tracking. A two-second `cairn add` that dumps into an
inbox, triaged later, will get used far more than a well-structured board that
demands ceremony.

### Deliberately cut from v1

Constraints hash and the nominate/review queue. Constraints still exist as a
loaded, human-owned section and the protocol tells agents to leave them alone —
the concept ships, the enforcement follows once we know whether agents respect it.

Also cut: plan stamping and orphan sweep, tags, priorities, dependencies, board
rendering of any kind, and obviously any UI. The plan sweep is the best demo in
the design and still not core value, so it goes in the first point release where
it can be the reason people upgrade.

### Build constraints

Zero runtime dependencies. For a package whose pitch is "bolts into any project,"
a dependency tree is a reason not to install it. Bun's built-in argv parsing plus
hand-rolled frontmatter covers everything here.

Derived state is always gitignored. The board must never generate a merge
conflict.

TypeScript, bun, roughly a thousand lines.

## 12. Rejected

Inferring status from git — branch name equals task id, merged PR equals done. It
demos beautifully and fights you the moment a workflow deviates. Keep state
explicit.

A web UI in v1. Solo devs already have an editor open, and the moment there is a
server, state lives outside git.

Symbol-level code linking. Rots on the first refactor, needs a parser per
language.

Asking the owner of the dormant `cairn` npm package to transfer the name. Last
real release June 2017, ninety-six downloads last month, effectively abandoned —
but a transfer request is an unanswered-email-shaped delay in front of a weekend
project, for a marginal gain over `cairns`.

## 13. Deferred ideas

Constraint-dependency tracking on plans, so superseding a constraint flags every
plan that assumed it. The most precise staleness signal available and the most
ceremony; git drift catches most of the same cases for free.

Terminal board rendering, and a generated markdown table embeddable in a README so
the board renders on a git host.

Automatic staleness sweeps that recheck constraints against lockfile versions on a
schedule rather than at read time.

## 14. Success test

Use it on one real repo for two weeks and count how many times reverse lookup
surfaces something genuinely forgotten. Not whether it felt nice — that number.

If the count is zero, the memory thesis is wrong and the honest move is to delete
the constraints and log tiers and ship a plain capture tool.
