---
version: 1
id: t-2drr1yne89362z
title: Stop losing task-to-code links when no task is active at commit time
status: done
created: 2026-08-01
updated: 2026-08-01
closed: 2026-08-01
targets: [src/lib/githooks.ts, src/lib/task.ts, src/lib/related.ts, src/commands/link.ts, src/commands/retrieve.ts, src/cli.ts]
---

<!-- cairns:done-when:begin -->
## Done when
- committing with no active task prints a visible warning naming the fix, on stderr, without blocking the commit
- the warning stays quiet during amend, rebase, cherry-pick and merge, so replaying history is not a wall of noise
- a branch whose name contains a task id stamps the trailer without cairn start
- branch inference refuses any id that has no directory under .tasks/, so a branch like hotfix-t-shirt-sizing stamps nothing
- an explicit cairn start still wins over the branch name
- cairn link <id> <rev-or-range> records the files those commits touched against the task
- backfilled paths are stored and labelled separately from declared targets and from commit trailers, so related never reports a backfill as either one
- cairn link refuses a revision git cannot resolve rather than silently recording nothing
- tsc --noEmit is clean and the full test suite passes
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
(compacted on close — full text is in the log)
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
The trailer hook now fails loudly instead of silently: it reads .tasks/.active, falls back to a task id in the branch name (discarding any candidate without a task directory, so hotfix-t-shirt-sizing links to nothing), and prints a two-line stderr notice naming the fix when it finds neither. It stays silent while git replays a message, which needs the sequencer state files because rebase and cherry-pick both report $2 as 'message' exactly like commit -m. cairn link <id> <rev-or-range> backfills commits that missed the trailer into a separate 'linked:' frontmatter key, reported by related as '(via backfilled commits, not trailers)' — kept apart from both targets and the trailer index so no label claims provenance it does not have. Two defects surfaced while building it: diff-tree needs --root or the first commit of a repo backfills nothing, and installOne dropped the chain when upgrading a chained hook, which silently disabled a third-party post-commit hook on app.hermen.io until it was fixed and restored. HOOK_VERSION is 2; every repo running cairns needs cairn init --hooks. 95 tests.
<!-- cairns:outcome:end -->
