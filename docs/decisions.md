# Decision log

## TypeScript and one project

Use TypeScript to extend the user's Python experience toward full-stack integration. Keep this initial project small rather than introducing a workspace orchestrator before multiple packages need it. Compile with strict settings, use Node's test runner, and pin dependencies with a lockfile.

## Official SDK and explicit error mapping

The assessment names `@modelcontextprotocol/sdk`; the project pins version 1.30.0. The low-level `Server` API is an advanced API, intentionally used for the required `-32602` tool-argument failures. This is an assessment-specific error policy: the MCP tools guidance describes validation/business execution errors as tool results in high-level workflows. The implementation retains tool-result errors for missing customers and unsupported money amounts.

The SDK owns initialization, request IDs, message serialization, and stdio framing. Its transport exposes framing failures through `onerror`; the entry point converts malformed JSON and invalid envelopes to supported error messages. When no request ID can be recovered, the pinned SDK represents the error with an omitted ID. This differs from generic JSON-RPC examples using `id: null` and should be reviewed when changing protocol/SDK versions. Unknown methods remain SDK `-32601` errors.

## Input assumptions

`CUST-XXXXX` means five ASCII digits. IDs are case-sensitive and not trimmed. Reasons are trimmed before checking a ten-character minimum. All extra tool arguments are rejected. Positive finite JSON numbers include integers; numeric strings and booleans are not coerced.

## Money and simulated refunds

Amounts enter as the required JSON number. USD whole-cent support is a business constraint, not a narrower advertised positive-float schema. Parse the number's decimal representation into integer cents; reject fractional cents and amounts outside the safe integer range. No silent rounding and no payment API.

The assessment lacks an order ID and idempotency key. Every valid invocation creates a new receipt. Do not invent duplicate detection by hashing customer/amount/reason: a legitimate repeated refund could have the same fields. Real payments would require a stronger business model, authorization, and retry semantics.

## SQLite and privacy

Use built-in `node:sqlite` to avoid a native third-party database dependency. This API can emit an experimental warning on stderr; code is tested locally on Node 25.5.0, with Node 22/24 CI configured but not yet executed remotely. Keep synchronous transactions short. WAL and a busy timeout are configured; this milestone makes no throughput claim.

Refund creation and its success audit event are atomic. Refund reasons are stored in the fictional demo database but excluded from diagnostic logs and returned receipts. Attempt outcomes are logged to stderr. Durable denied-attempt auditing belongs to the upcoming security gateway.

## Verification

Six local tests pass. Five exercise the actual process boundary. The transaction test injects an audit failure and confirms there is no refund left behind. The wire harness rejects every stdout line that is not a valid, expected MCP message. A separate SDK-client demo verifies interoperability with the official client API.
