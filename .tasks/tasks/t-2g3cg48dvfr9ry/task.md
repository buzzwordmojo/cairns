---
version: 1
id: t-2g3cg48dvfr9ry
title: "The open table is unreadable at 50 rows: oldest-first, no dates, three mostly-empty columns"
status: done
created: 2026-08-30
updated: 2026-08-30
closed: 2026-08-30
---

<!-- cairns:done-when:begin -->
## Done when
- the newest task is the first row
- a column no row in that table uses is not rendered
- age is scannable without the page depending on the clock
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
The open and in-progress tables are newest-first, carry a Created column, and drop any column no row in that table uses. collect() reverses listTasks because ids sort ascending and the untouched order buried today's work under every task ever opened. The table is now driven by a COLUMNS array with a used() predicate evaluated per table, not per board — verified on scrapcycle where In progress renders 5 columns and Open renders 6 off the same page. Title moved last because it is the only wide cell (74 chars median, 180 worst on that board), so everything scannable stays on the left edge. Age bucketing was asked for and refused: renderBoard is contractually clock-free, and a boundary derived from today would make the same .tasks/ render different bytes tomorrow, so render --check would call a correct page stale every midnight — the Created column is the clock-free substitute and the dead end records the mechanism. Worth knowing: dropping empty columns pays far less on a busy board than a fresh one, because across 52 open rows something fills every column. The pipe-escaping test had hardcoded a five-cell row, encoding the old column count rather than the invariant; it now compares row cells against header cells. 132 tests.
<!-- cairns:outcome:end -->
