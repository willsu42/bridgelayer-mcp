# Continue BridgeLayer development in VS Code

BridgeLayer is Yu-Chen Su's (Will's) independent software and AI development project. His role is Independent Software & AI Consultant. The existing personal/FDE prototype was named SupportBridge; the new active professional development phase began September 11, 2026. The current documentation uses BridgeLayer while working runtime identifiers retain the earlier name.

## Context for the next session

> Read README.md, docs/PROJECT_SCOPE.md, docs/PROJECT_PLAN.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_PLAN.md, and docs/decisions.md. Continue from the completed inspection and documentation reconciliation; do not restart analysis from scratch. The existing stdio MCP server, two customer tools, SQLite, tests, and scripted demo predate September 11. HTTP security and all AI functionality remain planned. The current phase focuses on gateway design, restart regression evidence, HTTP/security integration, hardening, and a local demonstration. Discuss material architecture decisions before implementation. I am comfortable with Python and learning TypeScript/MCP, so use Python comparisons and inspect code with me in VS Code. Follow explain → agree → implement → demonstrate → practice explaining back.

## Current evidence and limits

- September 11, 2026: `npm run check` passed strict type checking and all six tests; the SDK demo completed discovery, lookup, simulated refund, and invalid-amount rejection.
- That run used installed dependencies and Node 25.5.0 / npm 11.8.0. Node 24 is the recommended project runtime; remote Node 22/24 CI execution is unverified.
- Documentation and the BridgeLayer name have been reconciled. No new source functionality was implemented by that update.
- The inspected workspace has no Git metadata; original history and remote issues could not be audited. Do not infer that no original checkout exists elsewhere.
- Earlier handoff statements about no remote repository, API keys, or hosting were historical session context. Current evidence establishes no application use of external credentials, no live client/payment/LLM integration, and no verified deployment; it does not establish external account state.
- All customer records are fictional and refunds are simulated. No actual client engagement is evidenced.

## Next work

Start with gateway design (D1) and the full-restart refund/audit regression (D3) in the [backlog](docs/DEVELOPMENT_PLAN.md). Agree HTTP/session handling, downstream protection and credentials, failure mapping, and denial-audit storage. The scoped customer dataset remains shared and fictional; tenant-claim validation must not be advertised as data isolation.

## Files to inspect during implementation

- [schemas.ts](src/customer/schemas.ts): runtime validation and inferred types.
- [store.ts](src/customer/store.ts): customer lookup, integer cents, and atomic refund/audit writes.
- [server.ts](src/mcp/server.ts): discovery, dispatch, errors, and the malformed-envelope logging gap.
- [stdio.ts](src/mcp/stdio.ts): process boundary, framing, and shutdown.
- [mcp.test.ts](tests/mcp.test.ts): existing process tests and the restart coverage gap.
- [Walkthrough](docs/01-mcp-walkthrough.md): Python comparisons and request tracing.

Open the existing `supportbridge.code-workspace` or project folder. The workspace debugger supports attaching to the demo's server child process. The long-term [plan](docs/PROJECT_PLAN.md) retains four workstreams; later AI/UI work is separate from the active [scope](docs/PROJECT_SCOPE.md).
