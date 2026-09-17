# Continue BridgeLayer development in VS Code

BridgeLayer is Yu-Chen Su's (Will's) independent software and AI development project. His role is Independent Software & AI Consultant. The existing personal/FDE prototype was named SupportBridge; the new active professional development phase began September 11, 2026. The current documentation uses BridgeLayer while working runtime identifiers retain the earlier name.

## Context for the next session

> Read README.md, docs/PROJECT_SCOPE.md, docs/PROJECT_PLAN.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_PLAN.md, docs/decisions.md, and docs/02-http-gateway-walkthrough.md. Continue from the completed inspection and Task 2 implementation; do not restart analysis from scratch. Task 1's stdio server, two customer tools, SQLite, and initial tests/demo predate September 11. Task 2's HTTP service/security gateway, denial auditing, and restart regression were added during the active phase and locally verified September 15. Tasks 3–4, UI, and all LLM/agent functionality remain planned. Walk through the gateway trust boundaries and failure cases before proposing the next milestone. I am comfortable with Python and learning TypeScript/MCP; use Python comparisons and inspect code with me in VS Code. Follow explain → agree → implement → demonstrate → practice explaining back.

## Current evidence and limits

- September 11, 2026: `npm run check` passed strict type checking and all six tests; the SDK demo completed discovery, lookup, simulated refund, and invalid-amount rejection.
- That run used installed dependencies and Node 25.5.0 / npm 11.8.0. Node 24 is the recommended project runtime; remote Node 22/24 CI execution is unverified.
- Documentation/name reconciliation was followed by Task 2 implementation. September 15: type checking, 23 tests/subtests, and the HTTP SDK-client demo passed locally on Node 25.5.0.
- Git metadata was absent in the initial inspection and is now present. Task 2 has not rewritten or backdated history.
- Earlier handoff statements about no remote repository, API keys, or hosting were historical session context. Current evidence establishes no application use of external credentials, no live client/payment/LLM integration, and no verified deployment; it does not establish external account state.
- All customer records are fictional and refunds are simulated. No actual client engagement is evidenced.

## Next work

Run `npm run demo:http` and inspect the [HTTP walkthrough](docs/02-http-gateway-walkthrough.md). Explain why discovery is unfiltered, denied calls never execute downstream, credentials differ, and a timed-out refund must not be retried automatically. Review the completed items and remaining environment checks in the [backlog](docs/DEVELOPMENT_PLAN.md) before discussing Task 3. Shared fictional customers still have no tenant isolation.

## Files to inspect during implementation

- [schemas.ts](src/customer/schemas.ts): runtime validation and inferred types.
- [store.ts](src/customer/store.ts): customer lookup, integer cents, and atomic refund/audit writes.
- [server.ts](src/mcp/server.ts): discovery, dispatch, errors, and the malformed-envelope logging gap.
- [stdio.ts](src/mcp/stdio.ts): process boundary, framing, and shutdown.
- [mcp.test.ts](tests/mcp.test.ts): existing process tests, now including original refund/audit verification after restart.
- [Gateway](src/gateway/server.ts), [JWT validation](src/gateway/auth.ts), and [HTTP tests](tests/http.test.ts): Task 2's execution policy, credentials, and failure evidence.
- [Walkthrough](docs/01-mcp-walkthrough.md): Python comparisons and request tracing.

Open the existing `supportbridge.code-workspace` or project folder. The workspace debugger supports attaching to the demo's server child process. The long-term [plan](docs/PROJECT_PLAN.md) retains four workstreams; later AI/UI work is separate from the active [scope](docs/PROJECT_SCOPE.md).
