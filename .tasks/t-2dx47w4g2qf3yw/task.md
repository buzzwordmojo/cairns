---
version: 1
id: t-2dx47w4g2qf3yw
title: Render the board as markdown so it displays in the GitHub repo viewer
status: done
created: 2026-08-03
updated: 2026-08-03
closed: 2026-08-03
---

<!-- cairns:done-when:begin -->
## Done when
- cairn render writes .tasks/README.md, which GitHub displays under the file listing when browsing .tasks/
- the rendered page is a pure function of .tasks/ — no timestamp, no git-derived staleness, so the same board renders byte-identical in every clone
- task ids link to their task.md by a relative path that resolves in the GitHub viewer
- dead ends and open questions are on the page, since they are the reason to look at it
- any cap applied to a section says on the page that it was applied, and how to see the rest
- cairn render --check exits non-zero when the file is stale, so CI can catch a board that was not regenerated
- a committed derived file cannot produce a merge conflict a human has to resolve by hand (the mechanism named here at open time was "a driver that regenerates instead of merging"; that turned out to be unworkable — see the dead end on this task — and the shipped mechanism is a driver that keeps one side plus a post-merge re-render)
- the .gitattributes block is versioned, so an existing install picks up rules added after it was written
- cairn uninstall removes every line and git config key this adds
- tsc --noEmit is clean and the full test suite passes
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
(compacted on close — full text is in the log)
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
cairn render writes .tasks/README.md, which a git host renders under the file listing when you click .tasks/ — open work, open questions, recorded dead ends with their mechanisms, and closed outcomes, each id linking to its task.md. The page is a pure function of .tasks/: no clock, and project notes render without markStale because markStale asks git whether a path moved, which would make the bytes differ between a full clone and a shallow CI checkout. It is the only derived file cairns commits, so DESIGN.md:617 is satisfied by making it un-mergeable rather than untracked — .gitattributes routes it to a driver configured as 'true' (keep one side, never conflict) and the new post-merge hook re-renders once the working tree is whole. Regenerating inside the merge driver looks obvious and is silently wrong: git runs drivers before the rest of the merged tree lands, so it rendered 2 of 3 task dirs and produced a clean merge missing a row. cairn render --check is the CI form; a workflow that commits the page back races your own push. HOOK_VERSION is 3 and .gitattributes is v2 — the old marker check was an unconditional early return, so existing installs could never receive a new rule. 112 tests.
<!-- cairns:outcome:end -->
