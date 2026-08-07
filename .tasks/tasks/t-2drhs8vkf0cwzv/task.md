---
version: 1
id: t-2drhs8vkf0cwzv
title: Publish cairns to npm
status: done
created: 2026-08-01
updated: 2026-08-03
closed: 2026-08-03
targets: [package.json, src/cli.ts, README.md]
---

<!-- cairns:done-when:begin -->
## Done when
- cairns installs from the public registry via npx cairn on a machine that has never seen this repo
- the published version signals early-release status rather than implied stability
- the token used to publish does not sit in shell history, a transcript, or a long-lived temp file afterward
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
cairns is on the public registry: 0.0.1 landed 2026-08-03T12:04Z and 0.0.2 followed the same day with cairn render. Verified the way the criteria asked rather than by trusting the publish output — installed cairns@0.0.2 into an empty directory with no clone in sight, ran cairn init, add and render from node_modules/.bin, and got a board page. Publish auth is the _authToken line in ~/.npmrc, npm's own credential store; npm-token.txt is gone from disk and git log --all confirms it was never committed, and npm-token* is now gitignored so a recreated one cannot ride along in git add -A. The two dead ends here recorded direct token publishing as blocked by 2FA — that is no longer what happens, and what changed between then and the 12:04Z publish is not recorded, so treat the OIDC/GitHub Actions route as unproven rather than rejected. Version stays on the patch line at Bob's call: 0.0.x signals an interface still settling, which a minor bump would contradict.
<!-- cairns:outcome:end -->
