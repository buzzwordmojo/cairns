---
version: 1
id: t-2dq9evg6cxsmyy
title: Build cairns v1 from DESIGN.md
status: done
created: 2026-08-01
updated: 2026-08-01
closed: 2026-08-01
---

<!-- cairns:done-when:begin -->
## Done when
- CLI works end to end
- board TUI ships
- tests pass
- tsc clean
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
cairns v1 ships: 14 CLI commands, a zero-dep board TUI, 68 tests, zero runtime dependencies. Task state is .tasks/<id>/task.md plus an append-only log.ndjson merged with merge=union. Two bugs the tests caught are worth knowing about before touching ids or budget: the id tail needs >=40 random bits, and fit() must shrink or remove a block every iteration or cairn context hangs.
<!-- cairns:outcome:end -->
