# Task 4 closeout — November 3, 2026

**Task 4 is complete within the agreed deterministic-provider scope.** The remaining remote CI gate has been verified. Together with the earlier work, this closes all four prototype tasks; see [PROJECT_CLOSEOUT.md](PROJECT_CLOSEOUT.md).

## Verified revision and CI

Implementation revision: `dc381faccc90b8baea5da1cb6a45b6eba7a7c2c7` — `implement task 4`.

[GitHub Actions run 41320833908](https://github.com/willsu42/bridgelayer-mcp/actions/runs/41320833908) ran on November 1, 2026 (Asia/Taipei). Its run/job records were inspected November 3. Both jobs completed successfully, including `npm ci` and `npm run check`:

| Job | Result |
| --- | --- |
| [Node 22](https://github.com/willsu42/bridgelayer-mcp/actions/runs/41320833908/job/124890473493) | Clean dependency installation and type checking/build/tests passed. |
| [Node 24](https://github.com/willsu42/bridgelayer-mcp/actions/runs/41320833908/job/124890473753) | Clean dependency installation and type checking/build/tests passed. |

This evidence belongs to the exact implementation revision above, not a later documentation commit. It does not rely on Task 3's older CI results. The workflow runs installation and checks, not demos or benchmarks.

## Delivered and accepted

| Area | Acceptance evidence |
| --- | --- |
| Authenticated tenant budgets | JWT-derived tenant identity; shared allowance across subjects/roles within a tenant; spoofed request fields rejected. |
| Atomic admission | SQLite reservations before each provider attempt; independent worker connections cannot over-admit; lock contention fails closed. |
| Usage and persistence | Known/unknown settlement, exact rolling-window boundaries, separate live leases, restart recovery, late/duplicate report rejection, and clock rollback checks. |
| Bounded fallback | One separately admitted backup on eligible primary failure before output; primary cancellation and settlement first; no switch after output. |
| Failure/lifecycle handling | Timeout/success races, late primary replies, backup failure/timeout, overall cancellation, usage violations, and shutdown settlement tests. |
| Compatibility and demonstrations | All 66 local tests/subtests pass on Node 22.23.4 and 24.22.1; all four demos pass on Node 24. |
| Remote verification | Both CI jobs above passed for the Task 4 implementation. |

The local tests, clean installation, and demos were performed November 1 and are recorded in [TASK4_PROGRESS.md](TASK4_PROGRESS.md). This documentation closeout did not rerun them or change application code, dependencies, or CI configuration. No new commit, push, deployment, or workflow run was performed during closeout. Documentation whitespace and local-link checks were performed.

## Boundaries retained

The implemented route is `/resilient/stream`, with a separate SQLite token ledger, a 50,000-token per-tenant allowance over a sixty-second settlement window, conservative reservations, and a three-second first-usable-text fallback deadline. The [walkthrough](04-token-budgets-and-fallback-walkthrough.md) defines the exact policy.

Providers and token reports are synthetic; this is not live model integration or real token-cost measurement. Live adapters would need accurate input estimation, output limits, trusted usage reports, and cooperative cancellation. Customer data is still shared fictional data; budget isolation does not establish customer-data isolation. No multi-host capacity, production deployment, or real-payment authorization is claimed.

No Task 4 acceptance item remains open for the agreed scope. Any live provider, UI, external API, or deployment phase is new work with its own acceptance criteria.
