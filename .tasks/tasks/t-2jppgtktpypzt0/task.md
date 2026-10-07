---
version: 1
id: t-2jppgtktpypzt0
title: cairn related never answers from an index older than HEAD without saying so
status: open
created: 2026-09-30
updated: 2026-09-30
targets: [src/lib/index-cache.ts, src/lib/related.ts, src/commands/retrieve.ts]
night: false
kind: build
verify: bun install --silent && bun test && bun run typecheck
scope:
  - src/lib/index-cache.ts
  - src/lib/related.ts
  - src/commands/retrieve.ts
  - test/
base: HEAD
budget_minutes: 45
night_attempts: 0
---

<!-- cairns:done-when:begin -->
## Done when
- buildIndex records the HEAD sha it indexed instead of the empty string
- getIndex treats a cached index whose recorded sha differs from current HEAD as stale and rebuilds it, rather than returning any cached file it finds
- when the rebuild cannot run because the board needs migrate, related still answers but states the answer is stale and names the commit the index was built at
- a test covers the matchbook shape: an index recorded at an older sha with newer trailer commits present, asserting the fresh hits appear
- tests cover a fresh index, a stale index, and a board whose rebuild fails
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
Found 2026-09-30 while bridging t-2drpwb2bxnxjq6, which is itself unarmable and should be closed. Mechanism: buildIndex writes head:'' unconditionally (index-cache.ts:22) and head is read nowhere in the codebase; getIndex returns any cached file without comparing it to HEAD. The post-commit hook refreshes via (cairn reindex >/dev/null 2>&1 &), which discards failure by design. Reproduced in matchbook: cairn reindex exits 1 there (board still keeps tasks directly in .tasks/, needs migrate), the hook swallows it, and the index has sat frozen at 2026-08-03 while 23 trailer commits accumulated. cairn related answers from that index and says nothing. recipeasier is 1 commit stale the same way. headSha() already exists in src/lib/git.ts - no new git helper is needed. OUT OF SCOPE: src/lib/githooks.ts and the hook body entirely - a recorded dead end (l-2drrfamyz5pj9v) says installOne rewrote a hook body and silently orphaned a chained third-party hook live on app.hermen.io, and a HOOK_VERSION bump would force every repo to re-init. Self-healing in getIndex makes the hook's silent failure stop mattering, which is the better fix anyway. ALSO OUT OF SCOPE: running cairn migrate on matchbook (Bob's call, changes a board's layout), the trailer mechanism, and the trailer/linked/targets provenance labels.
<!-- cairns:context:end -->
