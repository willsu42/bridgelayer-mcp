# Continue BridgeLayer development in VS Code

BridgeLayer is Yu-Chen Su's (Will's) independent software and AI development project. His role is Independent Software & AI Consultant. The existing personal/FDE prototype was named SupportBridge; the new active professional development phase began September 11, 2026. The current documentation uses BridgeLayer while working runtime identifiers retain the earlier name.

## Context for the next session

**November 8 update:** Support Copilot Stage A is implemented as additional scope. Run `npm run demo:copilot` and open http://127.0.0.1:3040/. Read [COPILOT_STAGE_A.md](docs/COPILOT_STAGE_A.md) for the English workbench, real gateway lookup, guarded scripted drafts, demo session, cancellation, and reset. Local Node 24 validation passes 74 tests/subtests. No live model or token-budget/fallback integration into the new draft workflow is claimed.

> Tasks 1–4 are closed within the agreed prototype scope as of November 3, 2026. Read docs/PROJECT_CLOSEOUT.md and docs/TASK4_CLOSEOUT.md for the project explanation and final evidence. All four tasks remain covered by the final regression suite. Providers and token counts are synthetic; no live model is connected. The final implementation dc381fa passed remote Node 22/24 installation and checks. Review reservation/settlement/recovery and pre-output fallback before any live adapter work. I am comfortable with Python and learning TypeScript/MCP; use Python comparisons and follow explain → agree → implement → demonstrate → practice explaining back.

## Current evidence and limits

- September 11, 2026: `npm run check` passed strict type checking and all six tests; the SDK demo completed discovery, lookup, simulated refund, and invalid-amount rejection.
- That run used installed dependencies and Node 25.5.0 / npm 11.8.0. Node 24 is the recommended project runtime; remote Node 22/24 CI execution was unverified at that time.
- Documentation/name reconciliation was followed by Task 2 implementation. September 15: type checking, 23 tests/subtests, and the HTTP SDK-client demo passed locally on Node 25.5.0.
- Git metadata was absent in the initial inspection and is now present. Task 2 has not rewritten or backdated history.
- Earlier handoff statements about no remote repository, API keys, or hosting were historical session context. Current evidence establishes no application use of external credentials, no live client/payment/LLM integration, and no verified deployment; it does not establish external account state.
- All customer records are fictional and refunds are simulated. No actual client engagement is evidenced.
- October 27, 2026 (Asia/Taipei): Task 2 acceptance is complete. Node 24.22.1 / npm 11.19.1 clean installation, type checking, 23 tests/subtests, and both demos passed. Existing CI for `a744bfd` passed on Node 22 and 24. See [closeout evidence](docs/TASK2_CLOSEOUT.md), including the temporary runtime and cached-install conditions.

- November 3, 2026: all four tasks are closed. Final implementation `dc381fa` passed remote Node 22/24 CI; see [project closeout](docs/PROJECT_CLOSEOUT.md).

## Next work

The original four tasks remain closed. The [project closeout](docs/PROJECT_CLOSEOUT.md) and [TASK4_CLOSEOUT.md](docs/TASK4_CLOSEOUT.md) retain historical evidence. Stage A now adds the local browser workflow and has its own [validation record](docs/COPILOT_STAGE_A.md#validation). Stage B would connect a real provider and validated usage accounting. Stage C would add controlled resilience demonstrations and any agreed sharing/deployment work. No commit, push, deployment, or remote CI run is part of Stage A's local verification.

Explain why an unknown primary attempt keeps its reservation, why backup requires new admission, why active leases outlive historical usage, and why no fallback can follow emitted output. Live providers and extra PII formats remain future scope. The Stage A local UI is complete. Tenant budget isolation does not isolate customer data.

## Files to inspect during implementation

- [schemas.ts](src/customer/schemas.ts): runtime validation and inferred types.
- [store.ts](src/customer/store.ts): customer lookup, integer cents, and atomic refund/audit writes.
- [server.ts](src/mcp/server.ts): discovery, dispatch, errors, and the malformed-envelope logging gap.
- [stdio.ts](src/mcp/stdio.ts): process boundary, framing, and shutdown.
- [mcp.test.ts](tests/mcp.test.ts): existing process tests, now including original refund/audit verification after restart.
- [Gateway](src/gateway/server.ts), [JWT validation](src/gateway/auth.ts), and [HTTP tests](tests/http.test.ts): Task 2's execution policy, credentials, and failure evidence.
- [Walkthrough](docs/01-mcp-walkthrough.md): Python comparisons and request tracing.

Open the existing `supportbridge.code-workspace` or project folder. The workspace debugger supports attaching to the demo's server child process. The long-term [plan](docs/PROJECT_PLAN.md) retains four workstreams; later AI/UI work is separate from the active [initial phase scope](docs/PROJECT_SCOPE.md).
