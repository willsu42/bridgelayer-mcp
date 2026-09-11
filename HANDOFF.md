# Continue the learning session in VS Code

Open this project in VS Code and open the Codex sidebar. The installed extension can discuss files and selections; see the [official IDE guide](https://learn.chatgpt.com/docs/codex/ide). Sign-in state has not been checked.

Paste this into the IDE chat:

> Read README.md, docs/01-mcp-walkthrough.md, docs/architecture.md, and docs/decisions.md. This is my SupportBridge FDE portfolio project. I am comfortable with Python but new to TypeScript and MCP/gateway development. I want to understand the architecture, implementation decisions, and failure cases well enough to explain them in interviews. Task 1 is implemented; Tasks 2–4 and the React console are planned. Start by walking me through src/customer/schemas.ts and one request through the existing server. Explain TypeScript syntax using Python comparisons. Discuss material design choices before implementing the next milestone. Do not claim planned features are already implemented. Follow explain → agree → implement → demonstrate → practice explaining back. I prefer discussing and inspecting the code in VS Code.

## Current verification

- `npm run check`: strict type checking and all six tests passed locally.
- `npm run demo`: official SDK client completed discovery, lookup, simulated refund, and invalid-amount rejection.
- Local runtime: Node 25.5.0. Recommended project runtime: Node 24. Node 22/24 CI configuration is present but has not run on GitHub.
- No remote repository, hosted deployment, API keys, or real payment integration has been created.

## Files to inspect first

- `src/customer/schemas.ts`: runtime validation and inferred types.
- `src/customer/store.ts`: lookup, integer cents, and atomic refund/audit writes.
- `src/mcp/server.ts`: tool discovery, dispatch, and error mapping.
- `src/mcp/stdio.ts`: process boundary and logging isolation.
- `tests/mcp.test.ts`: real process tests and deliberately injected failures.

The full portfolio scope is preserved in docs/architecture.md. There is no Task 5. The user approved the incremental development-and-learning approach, then asked to move code review and discussion into VS Code.
