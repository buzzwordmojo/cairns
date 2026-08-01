---
version: 1
id: t-2drr1yne89362z
title: Stop losing task-to-code links when no task is active at commit time
status: doing
created: 2026-08-01
updated: 2026-08-01
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
matchbook installed the hooks at 10:51:53, committed 0f7b065 at 11:11 and bcb358f
at 11:46, and neither commit carries a Task: trailer. The hook was live the whole
time. It reads .tasks/.active and exits 0 when that file is empty, which it was
until cairn start first ran at 14:31. So the index stayed at
{head:"",paths:{},tasks:{}} and the reverse lookup the whole memory thesis rests
on had never actually run against real data.

The order that produced this is the normal adoption order — init, commit the
adoption, keep working, discover start later. Any repo that follows it loses the
link for exactly the early history worth linking.

Three fixes, in increasing order of how much they infer:
  1. make the skip audible instead of silent
  2. read the id off the branch name when nothing is active
  3. cairn link, to recover commits already made

On (3): trailers cannot be added to existing commits without rewriting history,
so the files have to be recorded somewhere else. They must not go into targets:.
related.ts documents targets as "intent, written at creation, never merged with
touched, which git derives" — folding backfilled paths in would launder derived
data into the declared channel and make the existing "via declared targets"
label a lie. A third provenance instead, labelled as itself.
<!-- cairns:context:end -->
