---
version: 1
id: t-2dr2048qx0g618
title: Fix two defects found trialling cairns on matchbook
status: done
created: 2026-08-01
updated: 2026-08-01
closed: 2026-08-01
---

<!-- cairns:done-when:begin -->
## Done when
- cairn log refuses stray positionals instead of joining them
- cairn related shows findings for open tasks, not just closed ones
- tests cover both
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
cairn log now refuses stray positionals instead of folding them into the message, and cairn related shows findings for open tasks first rather than reducing them to a bare id list. Both defects came from a ten-minute trial on matchbook, not from the test suite.
<!-- cairns:outcome:end -->
