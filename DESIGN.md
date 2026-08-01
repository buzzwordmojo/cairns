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
the design and is covered in section 5. Note that the table describes the end
state: until the promotion gate ships, constraints carry no authority and are
called Notes.

## 4. The task file

One file per task under `.tasks/`. File-per-task rather than a single board file,
because a single file conflicts constantly the moment you and an agent both write
to it, and it stops being loadable past roughly fifty tasks.

Task ids are collision-free from day one: a time-ordered Crockford base32 token,
`t-8k2fxq9m`. Not sequential integers. Backlog.md's single largest unresolved
failure is sequential ids colliding across clones, branches, and worktrees, and
its maintainer has ruled out fixing it on readability grounds — the entire
`doctor` command exists to repair collisions after the fact. Sequential ids look
friendlier right up until two agents allocate the same one. Examples in this
document use short ids like `t-042` for legibility only.

The frontmatter parser never throws. An absent field is a valid field with a
default, an unknown field is preserved untouched on rewrite, and there is no
schema migration — old files stay readable forever. Humans and agents both
hand-edit these files, so a parser that rejects input is a parser that loses data.
A `version:` key is written from the first release even though nothing reads it
yet, because retrofitting one costs far more than carrying it.

Structured sections carry sentinel comments so edits are surgical block
replacements rather than whole-body rewrites:

```markdown
<!-- cairns:done-when:begin -->
...
<!-- cairns:done-when:end -->
```

This keeps a diff to the block that actually changed, which both shrinks merge
conflicts and stops an agent rewriting a section it was only meant to append to.

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

But enforcing the form cannot enforce the truth, and this is the sharpest risk in
the design. An agent that just hit a dead end frequently does not understand the
mechanism — not understanding it is often why it was a dead end. A string check
for the word "because" selects for syntactically compliant confabulation and
rejects honest vagueness, which is precisely backwards. So "I don't know" is a
first-class shape, not a rejected one:

```
dead end: JWT verification fails intermittently under load
  mechanism: unknown
  evidence: <pasted error output>
```

Entries with an unknown mechanism are accepted, marked, and ranked below
mechanism-bearing entries in search. Evidence — a pasted error, a failing command,
a test name — outranks explanation everywhere, because evidence is checkable and
explanation is generated.

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

### The v1 honesty rule

An earlier draft of section 11 cut the hash, the nomination queue, and the review
flow from v1 while section 10 still told agents that constraints were
authoritative. That combination is strictly worse than having no constraints tier
at all, because it manufactures an authority label over text that nothing
protects.

So the two ship together or neither does. Until the gate exists, the section is
called Notes, agents may append to it like any other section, and no instruction
anywhere tells a model to trust it over its own reading of the code. Authority is
earned by enforcement, and claimed only after.

### Conflict-free by construction

The log is append-only and lives in `.tasks/<id>/log.ndjson`, one JSON object per
line, with `merge=union` set in `.gitattributes`. Two agents in separate worktrees
appending concurrently produce a union of both sets of lines rather than a
conflict.

This matters more than it sounds. Backlog.md, the most mature tool in this space,
ships no merge driver at all — one line of `.gitattributes`, `* text=auto` — and
its issue tracker shows concurrent agent sessions silently destroying each other's
notes because its `--notes` flag has replace semantics. Append-only plus union
merge makes that class of bug unrepresentable.

Human-facing rendering of the log stays markdown; NDJSON is the storage form
precisely because line-oriented append is what union merge understands.

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

If `cairn context` exceeds its ceiling it truncates, prints what was dropped and
which cap was violated, and exits zero. It must degrade, never fail — the failure
mode of a session-start command that errors is an agent with no context at all,
which is worse than an agent with slightly too much.

Predictable cost is the feature. A board whose context load grows with backlog
size gets uninstalled. For calibration: a user measured Backlog.md's MCP server
consuming fifteen to twenty percent of all tokens in a session, and the
maintainer declined to fix it. That is the failure this section exists to prevent.

Note that the seven-and-fifteen caps in section 5 cap truth, not tokens. The
sixteenth true constraint evicts a true one. That is a real cost, accepted
deliberately: an uncapped block is one nobody ever prunes, and a stale block is
worse than a short one.

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

The path-to-task index is a cache, never a source of truth. It lives in a
gitignored file rebuilt by a post-commit hook, because scanning full history per
query gets slow on a large repo, but every query must return the same answer with
the index absent — just slower. Derived state is never committed, or the board
invents a new class of merge conflict.

### The empty-result problem

Git hooks are not cloned. In a fresh clone, in CI, in a new worktree, or after
anyone runs `--no-verify`, there are no trailers and `related` returns nothing.
Nothing reads to an agent as "no prior art here," which is worse than never having
asked, because section 10 told it to ask and it got a clean answer.

So an empty result must never be silent. When hooks are missing or the queried
path predates board adoption, `related` says so explicitly — "no commit trailers
found in this clone; attribution unavailable, run `cairn init --hooks`" — and
`cairn context` asserts hook presence at session start. Absence of evidence is
reported as absence of evidence.

Squash merge, which is GitHub's default, collapses a branch into a single commit
and destroys per-file attribution permanently: the grep returns the union of every
file the branch touched. This caps achievable precision and cannot be fixed from
inside the tool. The fallbacks are the task's declared `targets`, and time-window
attribution against the task's active period. Both are weaker, and the output
should label which method produced each result rather than presenting a derived
guess as a record.

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

An earlier draft included "do not open a task for work you will finish this
session." It is removed: most dead ends happen inside a single session, so that
rule excluded the highest-value data in the system by construction. `cairn add` is
retroactively promotable to a logged task at close, which covers the mess it was
trying to prevent.

### Block installation

The block is delimited by `<!-- cairns:begin -->` and `<!-- cairns:end -->` with a
machine-readable version marker inside. Updating means stripping the old block and
reinserting at the same position, preserving everything around it, and reporting
created, updated, or unchanged. Backlog.md does exactly this and it is clearly
right — but it writes its version marker and never reads it. Read it: warn when
the installed block is older than the running binary.

Their trajectory on block size is worth heeding. They shipped a 757-line generated
block, retreated to a 20-line nudge that points at guides fetched on demand, and
kept 335 lines of guide content behind that call. The retreat was correct; the
replacement taxes every single request with a round trip. Fifty lines inline is
the better trade for a protocol this small.

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

The constraints hash and the nominate/review queue, together with the authority
language that depends on them, per section 5. Until the gate ships, the section is
Notes and claims nothing.

Also cut: plan stamping and orphan sweep, tags, priorities, dependencies, board
rendering of any kind, and obviously any UI. The plan sweep is the best demo in
the design and still not core value, so it goes in the first point release where
it can be the reason people upgrade.

Guard against flag accretion specifically. Backlog.md's `task edit` carries
thirty-nine options, several of which quietly differ in whether they append or
replace — and that ambiguity is how concurrent agent sessions destroyed each
other's notes in their issue tracker. Every write command here should have exactly
one semantic, and append should be the only one available on the log.

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

Sequential numeric task ids. They read better and they collide across clones,
branches, and worktrees the moment there is more than one writer. Backlog.md has
this problem in production, has declined to fix it on readability grounds, and
ships a repair command instead of prevention.

A single mutable notes field per task. It is what every comparable tool has, and
replace semantics on it is how accumulated reasoning gets silently destroyed.
Append-only or nothing.

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

The obvious test — use it for two weeks and count how often reverse lookup
surfaces something forgotten — is unfalsifiable. The author is also the evaluator,
"genuinely forgotten" is self-assessed, and cold start guarantees a thin corpus in
two weeks regardless of whether the idea is any good.

Pre-register this instead. After two weeks of real use, take ten dead ends the log
actually recorded. For each, open a fresh agent session on the relevant file and
give it the task, once with `cairn context` available and once without. Count how
many times the unaided session re-walks the recorded dead end.

That number is the product. If agents do not re-walk dead ends without the tool,
there is nothing to solve. If they re-walk them just as often with it, the
retrieval design has failed and the fix is in section 6, not in the thesis.

## 15. Prior art

### Backlog.md

github.com/MrLesk/Backlog.md — MIT, 6,339 stars, 6,720 npm downloads per week,
version 1.48 as of 2026-08-01, one maintainer, no monetization of any kind. The
mature tool in this space and the reason cairns is not a board.

It already ships: one markdown file per task with frontmatter under `backlog/`,
committed to the repo; zero runtime dependencies; a CLI aimed explicitly at humans
plus AI agents; an instruction block written into CLAUDE.md and AGENTS.md at init;
terminal kanban; an MCP server; and, since v1.45, a `modifiedFiles` field. Every
positioning claim in an early draft of this document, it holds first.

What it does not have, and what this design exists for: an append-only per-task
record of what was tried and failed, and reverse lookup from a source file to the
dead ends recorded against it. Its decisions live in separate ADR documents, its
`--notes` field has replace semantics that its own issue tracker shows destroying
accumulated agent history, and completed tasks are invisible in its search.

#### Taken

- Advisory lock scoped to the git common directory rather than the worktree, so
  all worktrees of a repo share one lock. Hold it across id allocation and file
  mutation only — never across git commits or console output.
- A parser that never throws, absent-field-is-valid, and no retroactive migration.
- Sentinel comment markers around structured sections for surgical replacement.
- Instruction block delimiters plus a version marker, strip-and-reinsert
  idempotency, and a created/updated/unchanged result. Unlike theirs, read the
  marker.
- `GIT_OPTIONAL_LOCKS=0` on read-only git invocations, and `stdin: "ignore"` on
  every spawn — the latter cost them a Windows deadlock under stdio.
- Auto-commit defaults to off, and never stages a whole directory. Their bare
  `git commit` over the whole board let one agent session commit another's
  unreviewed work.

#### Avoided

- Sequential ids, per section 12.
- Two orthogonal notions of doneness — a status string and a physical move into a
  `completed/` directory — which is the root of their cross-branch complexity.
- Denormalized parent and child pointers that drift apart.
- Case asymmetry between id in frontmatter and id in filename.
- Permissive input handling that becomes scar tissue: five accepted date formats
  with a UTC-midnight heuristic to guess date versus datetime, and regex
  pre-quoting of YAML because `@name` is not valid YAML.
- Command and flag accretion, per section 11.

#### Validated

Their issue tracker is the strongest available evidence for this design. Multi-
writer identity collisions are their dominant unresolved failure and are
philosophically locked shut by their manifesto. Concurrent agent sessions
overwriting each other's notes is reported and open. Context cost was measured at
fifteen to twenty percent of session tokens and the fix was declined. No tool in
the survey ships any mechanical enforcement of agent behaviour at all, which makes
because-clause validation a real differentiator rather than table stakes.

#### Encroachment risk

`modifiedFiles` in v1.45 is adjacent to reverse lookup. An open task in their own
board covers automatic drift detection. Against that: they removed a
dependency-inference feature rather than finish it, and the maintainer
consistently retreats from inference layers. Nothing suggests they are heading
toward failed-approach logs.

### Entire

github.com/entireio/cli — MIT, 4,877 stars, actively developed, backed by a sixty
million dollar seed round. Hooks git to capture agent sessions as checkpoints
indexed alongside commits, and markets capturing "the dead ends the agent tried"
with commit-to-session reverse lookup.

The nearest thing to this thesis, from the observability direction. It captures
raw session transcripts automatically and has no task model, no curation, and no
human-authored acceptance criteria. The bet cairns makes is that a small curated
record beats a complete automatic one, because the value is in what someone
decided to write down. That bet could be wrong, and this is the competitor to
watch.

### Everything else

git-bug stores issues as git objects with no agent angle. dstask is a personal
taskwarrior alternative. trackdown, taskmd, and tasks.md are all under a hundred
stars and mostly inactive. The general agent-memory space — AGENTS.md conventions,
memory MCP servers, mem0 — is crowded, but it is general memory rather than
task-scoped memory, and nothing found combines the two.
