---
version: 1
id: t-2dr27g0jay38k6
title: Make cairn init fully reversible
status: done
created: 2026-08-01
updated: 2026-08-01
closed: 2026-08-01
---

<!-- cairns:done-when:begin -->
## Done when
- every file cairn init touches is marked
- cairn uninstall removes them and restores chained hooks
- .tasks survives unless --purge
- tests cover it
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
cairn init is now fully reversible. Every file it writes carries a marker (cairns:begin/end in CLAUDE.md, cairns:hook in .git/hooks, cairns:attributes in .gitattributes) and `cairn uninstall` strips exactly those, restoring a chained hook from its .pre-cairns backup and declining to touch any hook without the marker. .tasks/ survives unless --purge. Verified by round-trip in a real repo that already had a CLAUDE.md, a .gitattributes rule and a foreign post-commit hook — all three came back byte-identical.
<!-- cairns:outcome:end -->
