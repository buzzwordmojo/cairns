---
version: 1
id: t-2g3dc8b2j8j7hy
title: DESIGN.md section 15 is dated to Backlog.md v1.48 and one of its claims has been fixed upstream
status: done
created: 2026-08-30
updated: 2026-08-30
closed: 2026-08-30
---

<!-- cairns:done-when:begin -->
## Done when
- every claim about Backlog.md carries the version it was checked against
- the concurrent-note-destruction claim reflects that v1.50.0 fixed it
- the v1.49.0 archive release line is not read as vindicating a completed/ directory
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
Section 15 is re-dated to Backlog.md v1.50.1 at 2026-08-30 and every claim now carries the version it was checked against. Three claims moved. Concurrent agent sessions destroying each other's notes is fixed upstream as of v1.50.0 — sections 5 and 15 now say so and use it, because their fix is a lock in front of a read-modify-write, which can only ever refuse one of two concurrent writers, while append-only plus union merge keeps both; that is a sharper differentiator than the bug was. The v1.49.0 release line about archiving completed tasks is explicitly flagged as not a feature: PR 787 is 151 pure renames into a backlog/completed/ directory that predates it, so it does not vindicate the completed/ design that section 15 Avoided rejects. Section 11 keeps the flag-accretion argument but drops its causal link to the note destruction, because the real mechanism was an unlocked read-modify-write and v1.48 had already spent a release making the append-versus-replace ambiguity deterministic. Added to Avoided: v1.50.1 is now the citation for the two-places-doneness bullet, since they withdrew CLI reads from cross-branch entirely rather than repair it — 394 git operations per read, task list 4.2s to 0.2s. Added to Taken: hide a board column no row fills, which is what the render change in this same session implements. Header numbers refreshed: 6,571 stars and 14,598 weekly downloads, up from 6,339 and 6,720.
<!-- cairns:outcome:end -->
