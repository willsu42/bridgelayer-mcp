# SupportBridge

A TypeScript FDE portfolio project built in learning milestones. The first milestone is a runnable customer MCP server with strict validation, persistent simulated refunds, and tests over actual stdio.

## Status

| Component | Status |
| --- | --- |
| Task 1: customer MCP server | Implemented and tested |
| SQLite customer/refund storage | Implemented and tested |
| Task 2: HTTP MCP security gateway | Planned |
| Task 3: streaming PII guardrail | Planned |
| Task 4: token limiter and model fallback | Planned |
| React support console | Planned |

There are four assessment tasks. The learning milestones divide that work into smaller steps.

## Run the first milestone

Use Node 24 (the recommended project runtime) and npm. Node 22.13+ provides the built-in SQLite API used here. Node can print an experimental SQLite warning to **stderr**, which does not contaminate protocol stdout.

```sh
npm ci
npm run check
npm run demo
```

The demo launches a real MCP server process, completes initialization, discovers the two tools, retrieves a customer, creates a simulated refund, and demonstrates a rejected request. It uses a temporary database and removes it afterward. Human-readable demo output comes from the **client process**.

For a persistent server, build first, then run:

```sh
npm run build
node dist/src/mcp/stdio.js
```

The server waits for newline-delimited MCP messages on stdin. It is not an interactive terminal prompt. An MCP host should spawn `node` directly with the absolute path to `dist/src/mcp/stdio.js`. Avoid spawning a normal `npm run` command as the transport: npm's script banner would share protocol stdout. `npm run --silent start:mcp` is available for manual use.

`SUPPORTBRIDGE_DB` overrides the default `data/supportbridge.sqlite` path, which is relative to the process working directory. All seeded records are fictional: `CUST-00001`, `CUST-00002`, and `CUST-00003`.

## Tool contract

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `get_customer_record` | `customer_id` | Returns a fictional customer or a business error |
| `trigger_refund` | `customer_id`, `amount`, `reason` | Saves a simulated USD refund and an audit event in one transaction |

Inputs are strict: five ASCII digits after `CUST-`, no extra argument properties, a finite positive JSON number, and a reason with at least ten characters after trimming. Strings such as `"12.50"` are not converted into numbers. Integer JSON numbers such as `12` are valid amounts.

The wire schema accepts positive numbers as the assessment requires. The refund domain then requires whole cents that fit in a JavaScript safe integer. Fractional cents and excessive amounts produce a business error rather than silently rounding. The receipt returns `amount_cents` and `currency` explicitly.

| Failure | Response |
| --- | --- |
| Invalid tool arguments / unknown tool | JSON-RPC `-32602` |
| Unknown JSON-RPC method | JSON-RPC `-32601` |
| Malformed JSON / invalid message envelope | `-32700` / `-32600`; no correlatable ID is included, following the pinned SDK's error envelope |
| Customer missing / unsupported monetary precision | MCP tool result with `isError: true` and a stable business error code |
| Unexpected customer-service exception | Sanitized JSON-RPC `-32603` |

The lower-level official SDK server is intentional: this assessment specifically requires invalid arguments to be JSON-RPC errors. See [the decision log](docs/decisions.md) for the distinction from high-level MCP tool errors.

## Explore in VS Code

Open this project folder or `supportbridge.code-workspace`. Start with [the learning guide](docs/01-mcp-walkthrough.md), then read the source in its suggested order.

The workspace includes Build, Test, and Demo tasks. The debugger can launch the demo client; the MCP server is a child process, so use the auto-attach option if you want to step through server execution too.

For an IDE discussion, open the Codex sidebar and use the prompt in [HANDOFF.md](HANDOFF.md). OpenAI documents discussing open files and selections in its [IDE guide](https://learn.chatgpt.com/docs/codex/ide).

## Verification and current limits

`npm run check` passes locally: strict type checking and six tests. Five tests launch the actual stdio server, covering discovery, invalid inputs, no writes after rejection, exact cents, rollback on an injected audit failure, sanitized errors, malformed frames, notification behavior, and stdout isolation. Another checks non-JSON numeric values at the schema boundary. The SDK-client demo also completes successfully.

Local verification used Node 25.5.0. CI is configured for Node 22 and 24, but has not been run on GitHub.

This milestone has no authentication, HTTP listener, LLM integration, or browser UI. Access to the local process currently grants access to its tools. Refunds never contact a payment system. Repeating the same request creates another receipt: the assessment has no order ID or idempotency key, so the implementation does not guess which calls are duplicates. Logs record attempts without customer records or refund reasons; the database audit table currently records successful simulated refunds only. See [the roadmap](docs/architecture.md) for the remaining components.
