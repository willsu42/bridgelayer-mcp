# Task 4 progress — Token budgets and model fallback

**Implementation/local validation: November 1, 2026. Closeout: November 3, 2026 (Asia/Taipei). Status: complete within the agreed deterministic-provider scope.** See [TASK4_CLOSEOUT.md](TASK4_CLOSEOUT.md) for verified remote CI.

Task 4 adds an authenticated, fixture-driven `/resilient/stream` route backed by a persistent SQLite tenant budget and one primary/backup attempt sequence. It uses deterministic provider mocks, preserves the Task 3 email guardrail, and retains existing MCP behavior. No live model call, model tokenizer, or paid token usage is claimed.

## Delivered

| Area | Implemented behavior |
| --- | --- |
| Tenant admission | Verified JWT tenant; shared 50,000-token allowance per tenant, independent of subject/role; extra tenant/token request fields rejected. |
| Reservation and accounting | Atomic 384-token reservation per attempt; final known usage replaces the reservation; unknown usage retains it in full. |
| Rolling window and recovery | Sixty-second settlement-based usage window, separate 120-second active leases, persisted restart recovery, exact boundary cleanup, and rollback-resistant ledger clock. |
| Fallback | One backup only after eligible primary failure before output; primary cancellation and settlement precede backup admission. |
| Deadline semantics | Three seconds to first usable upstream text; thirty seconds total across attempts and downstream waits; no fallback after useful-text stalls or any client output. |
| Failure safety | Conservative unknown accounting, invalid/over-reported usage errors, no late reconciliation refunds, and no fallback on ledger failure. |
| Lifecycle | Cancellation-aware provider interface; fresh guardrail per attempt; gateway shutdown waits for request settlement before closing the ledger. |
| Demo and documentation | `npm run demo:resilience`, a detailed walkthrough, and updated roadmap/handoff. |

The roadmap defaults were adopted for this development request. The [walkthrough](04-token-budgets-and-fallback-walkthrough.md) records the exact policies, rationale, synthetic-token contract, limitations, and error mapping.

## Validation performed

| Check | Result |
| --- | --- |
| Node 24.22.1 clean install | `npm ci` succeeded with the existing lockfile; 98 packages installed. An initial offline attempt found an incomplete temporary cache, so installation was retried with registry access. No dependency version changed. |
| Node 24.22.1 | Type checking, build, and **66 tests/subtests passed**; zero failures/skips. |
| Node 22.23.4 | Type checking, build, and **66 tests/subtests passed** against the installed dependency tree; zero failures/skips. |
| New resilience demo | Completed primary success, 429 fallback, actual three-second timeout fallback, post-output error, backup failure, unknown usage, and depleted-tenant rejection. |
| Existing demos on Node 24 | `demo:streaming`, `demo:http`, and `demo` all completed successfully. |
| Remote Node 22/24 CI, verified November 3 | Both jobs passed `npm ci` and `npm run check` for `dc381fa`; [run and job links](TASK4_CLOSEOUT.md). |

The 24 new tests comprise seven budget cases, twelve routing cases, and five HTTP cases, alongside the original 42 tests/subtests. Independent worker connections start admissions concurrently against the same SQLite file; the shared budget admits only one 600-token reservation under a 1000-token test allowance. An explicit lock-contention test verifies sanitized failure without implicit retry.

Other checks cover exact window boundaries, active reservations beyond the historical window, known/unknown charges across restart, expired-lease recovery, duplicate/late settlement, clock rollback, per-tenant isolation, primary success/timeout races, late primary results/usage, backup failure/timeout, exhausted backup allowance, no fallback after output, no fallback after a useful-text stall, overall cancellation, settlement failure, HTTP identity spoofing, usage overruns, and shutdown settlement.

The demo accumulated 1676 synthetic charged tokens for its main tenant across six scenarios. A separate tenant seeded at 50,000 was rejected with HTTP 429 without affecting the first tenant. The timeout scenario took approximately three seconds, as configured; this is functional demonstration evidence, not a latency benchmark or production capacity claim.

The verified runtime binaries were already available under `/tmp`; the system runtime was not changed. HTTP tests required loopback listener access outside the execution sandbox. The local implementation session did not create a source commit, push, deployment, or remote workflow run. The implementation was subsequently committed as `dc381fa`; its existing CI result was verified November 3. Closeout did not rerun the November 1 local checks.

## Acceptance status and scope limits

The remote CI gate is closed: [run 41320833908](https://github.com/willsu42/bridgelayer-mcp/actions/runs/41320833908) passed on Node 22 and 24 for the Task 4 implementation. All agreed Task 4 acceptance items are complete; the [project closeout](PROJECT_CLOSEOUT.md) consolidates Tasks 1–4.

This implementation is a local infrastructure demonstration. Token counts and input estimates are synthetic, not calculated from text; live adapters must supply accurate estimates, honor the output cap, report trustworthy final usage, and cooperate with cancellation. Invalid actual usage can be charged after the fact but cannot be undone. Budget isolation does not provide customer-data isolation. Live LLM integration, additional PII formats, UI, hosted operation, multi-host budgets, and production load testing remain separate work.

Review with:

```sh
npm run check
npm run demo:resilience
```

See the [Task 4 walkthrough](04-token-budgets-and-fallback-walkthrough.md) and [long-term project plan](PROJECT_PLAN.md).
