---
version: 1
id: t-2drpwb2bxnxjq6
title: Reverse lookup is untested in practice because the commit-derived index never populates without commits
status: done
created: 2026-08-01
updated: 2026-09-30
closed: 2026-09-30
---

<!-- cairns:done-when:begin -->
## Done when
- cairn related returns commit-derived hits, not only declared targets, on at least one repo
- the two-week trial measures the commit-derived path rather than frontmatter targets
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
Closed without building: both criteria are dead, for different reasons. Criterion 1 (cairn related returns commit-derived hits) was satisfied in August and logged here on 2026-08-01 — measured again 2026-09-30, the commit-derived index populates in 4 of 6 repos: scrapcycle 254 paths/18 tasks, recipeasier 84/7, cairns 59/4, matchbook 11/1. Criterion 2 (the two-week trial measures the commit-derived path) is unverifiable by any command — no command makes time pass — and is moot anyway after two months of real use. Because Gate.ts counts missing fields and cannot read prose, this task ranked first in the Nightshift idle block for three consecutive kaizen briefs while being unarmable; that is what prompted the measurement. Measuring it surfaced a live defect that IS buildable, now tracked as t-2jppgtktpypzt0: the index populates and then never refreshes, and nothing says so. buildIndex writes head:'' unconditionally (index-cache.ts:22) and head is read nowhere; getIndex returns any cached file without comparing it to HEAD; the post-commit hook refreshes via (cairn reindex >/dev/null 2>&1 &), which discards failure by design. Reproduced in matchbook: cairn reindex exits 1 there (board needs migrate), the hook swallows it, and the index sat frozen at 2026-08-03 while 23 trailer commits accumulated, with cairn related answering from it silently. recipeasier is 1 commit stale the same way. So the reverse lookup this task worried about is not untested — it is tested and quietly wrong in exactly the repos that went longest without a successful reindex.
<!-- cairns:outcome:end -->
