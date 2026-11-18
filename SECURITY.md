# Security

Report security issues privately to app@outdoortechnica.com. Include the affected
commit, reproduction and impact; do not post credentials or private server data.
The current main branch is the supported version.

Public archive reads require no authentication. Discord settings require signed
interactions and server-manager permissions. Keep runtime secrets, databases and
state outside Git, and deploy behind HTTPS with request limits at the edge.

CI runs component tests, builds, dependency checks and high/critical production-image
scans with a digest-pinned Trivy container. The scanner receives only exported images,
never the Docker socket or application secrets. Dependabot proposes weekly
npm, container and Actions updates; review and test those changes before merging.
Pinned runtime and scanner images still need regular review and updates.

The audit checker fails on every reported severity and on invalid audit output.
One temporary exception covers only withdrawn advisory
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), verified
withdrawn on 18 November 2026 while npm still reports it. The exception expires
18 December 2026, does not suppress new advisories on the same package, and should
be removed once npm's feed refreshes. Raw audit reports remain available in CI.
