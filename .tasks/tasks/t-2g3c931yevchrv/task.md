---
version: 1
id: t-2g3c931yevchrv
title: The rendered board page goes stale because only post-merge re-renders it
status: done
created: 2026-08-30
updated: 2026-08-30
closed: 2026-08-30
---

<!-- cairns:done-when:begin -->
## Done when
- every command that mutates .tasks/ leaves cairn render --check passing
- a failed page write never fails the mutation that already landed
- the refresh is not on any git hook, so no HOOK_VERSION bump and no forced cairn init --hooks
- typecheck clean and the full suite passes
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
The board page now refreshes from the CLI dispatch after any mutating command, so it can no longer go stale between merges. src/cli.ts carries a MUTATES set beside COMMANDS (init, migrate, add, start, stop, done, log, ask, answer, edit, link — uninstall deliberately absent because it deletes the page), and main() calls refreshBoardPage only when the handler returned 0, so a refused command does not render on its way out. refreshBoardPage is best-effort and swallows everything: a page that cannot be written must never fail a mutation that already landed on disk, and cairn render --check stays the thing that reports staleness out loud. Writes go through a temp file and rename, which cairn render now shares, rather than taking the board lock — the refresh runs after the command released it and a nested withLock would spin its full 5s deadline first. No git hook changed, so HOOK_VERSION stays 3 and no repo needs cairn init --hooks; the fix arrives on npm upgrade. Found live: next.scrapcycle.org rendered on 2026-08-07 and then drifted three weeks to a page claiming 34 open and 9 closed against 51 open, 1 doing and 18 done on disk. Re-rendered, that board grows from 34 to 52 open rows, and its dead ends go 5 to 16 and open questions 0 to 3 — the stale page was hiding the two sections that carry the memory value. 127 tests.
<!-- cairns:outcome:end -->
