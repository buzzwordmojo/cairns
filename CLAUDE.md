<!-- cairns:begin v1 -->
## Task board protocol

Work in this repo is tracked in `.tasks/`. Those files record what is being
built and why.

### Starting work
Run `cairn context`. It prints project notes, the active task, and the open
backlog. Notes are hand-written and unverified — weigh them against the code
rather than deferring to them.

### Before proposing an approach
Run `cairn search <term>`. Prior attempts and dead ends are recorded there.
Do not propose an approach the log records as failed unless you state why the
recorded reason no longer applies.

### While working
Append findings as you get them, not at the end:
  cairn log <id> "decided: <what> because <why>"
  cairn log <id> "dead end: <what failed> because <mechanism>"
  cairn log <id> "note: <fact discovered>"

- State the mechanism, not the verdict. Write "middleware runs after the
  response flushes", not "middleware doesn't work". Verdicts go stale
  invisibly; mechanisms can be rechecked.
- If you cannot state a because, you have a symptom, not a finding. Say so —
  `--mechanism unknown --evidence "<pasted error>"` is a valid entry.
- Never log status narration. Git already records what changed.
- One entry per finding.

### Finishing
A task is done when every line under "Done when" is verifiably true. If you
cannot verify a line, say so instead of marking it done.
  cairn done <id> --outcome "<what shipped; what a future reader needs>"

### Never
- Do not delete or rewrite log entries. Overturn instead:
  cairn log <id> "supersedes <log-id>: <what is true now> because <why>"
- Do not hand-edit `.tasks/*/log.ndjson`. It is append-only.

### Uncertainty
If you need a human decision, do not guess:
  cairn ask <id> "<question>"
The question appears in default context until answered.
<!-- cairns:end -->
