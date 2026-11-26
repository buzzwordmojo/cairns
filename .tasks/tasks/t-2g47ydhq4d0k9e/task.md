---
version: 1
id: t-2g47ydhq4d0k9e
title: "Publishing 0.0.4 is blocked: the npm token in ~/.npmrc is rejected"
status: done
created: 2026-08-30
updated: 2026-11-26
closed: 2026-11-26
---

<!-- cairns:done-when:begin -->
## Done when
- npm whoami returns the account rather than 401
- npm publish puts 0.0.4 on the registry
- cairns@0.0.4 installs into an empty directory and cairn render works from node_modules/.bin
<!-- cairns:done-when:end -->

<!-- cairns:context:begin -->
## Context
<!-- cairns:context:end -->

<!-- cairns:outcome:begin -->
## Outcome
0.0.4 is on the registry (published 2026-11-26, tag v0.0.4 at 1a0d684). The old ~/.npmrc token was rejected (401). Web login worked only with --browser=false on npm 10.9, but publish still 403'd: the account logs in with emailed OTPs, which publish does not accept. What worked was a short-lived granular token Bob minted, used from a temp --userconfig file that was then deleted. Verified by installing cairns@0.0.4 from the registry into an empty repo: --version 0.0.4, and init, add and render ran. The tarball 404'd for ~4 minutes after the packument showed 0.0.4, which is CDN lag, not a failed publish. For the next release, set up an authenticator TOTP or GitHub trusted publishing.
<!-- cairns:outcome:end -->
