# BridgeLayer — Decision Log

This log preserves the technical reasoning of the earlier SupportBridge FDE prototype. BridgeLayer is the approved documentation name for the continuing project. The active professional development phase began September 11, 2026; the existing server predates it. See [current architecture](ARCHITECTURE.md), [phase scope](PROJECT_SCOPE.md), and [long-term plan](PROJECT_PLAN.md).

## TypeScript and one project

Use TypeScript to extend the user's Python experience toward full-stack integration. Keep this initial project small rather than introducing a workspace orchestrator before multiple packages need it. Compile with strict settings, use Node's test runner, and pin dependencies with a lockfile.

## Official SDK and explicit error mapping

The original FDE integration scenario specified `@modelcontextprotocol/sdk`; the project pins version 1.30.0. The low-level `Server` API was intentionally chosen for that scenario's required `-32602` tool-argument failures. This remains the project's compatibility contract, not a universal MCP error policy. High-level MCP tool workflows distinguish tool-result errors; this implementation uses those for missing customers and unsupported money amounts.

The SDK owns initialization, request IDs, message serialization, and stdio framing. Its transport exposes framing failures through `onerror`; the entry point converts malformed JSON and invalid envelopes to supported error messages. When no request ID can be recovered, the pinned SDK represents the error with an omitted ID. This differs from generic JSON-RPC examples using `id: null` and should be reviewed when changing protocol/SDK versions. Unknown methods remain SDK `-32601` errors.

## Input assumptions

`CUST-XXXXX` means five ASCII digits. IDs are case-sensitive and not trimmed. Reasons are trimmed before checking a ten-character minimum. All extra tool arguments are rejected. Positive finite JSON numbers include integers; numeric strings and booleans are not coerced.

## Money and simulated refunds

Amounts enter as the required JSON number. USD whole-cent support is a business constraint, not a narrower advertised positive-float schema. Parse the number's decimal representation into integer cents; reject fractional cents and amounts outside the safe integer range. No silent rounding and no payment API.

The original FDE integration scenario provides no order ID or idempotency key. Every valid invocation creates a new receipt. Do not invent duplicate detection by hashing customer/amount/reason: a legitimate repeated refund could have the same fields. Real payments would require a stronger business model, authorization, and retry semantics.

## SQLite and privacy

Use built-in `node:sqlite` to avoid a native third-party database dependency. This API can emit an experimental warning on stderr; code was tested locally on Node 25.5.0, with Node 22/24 CI configured but remote execution unverified. Keep synchronous transactions short. WAL and a busy timeout are configured; this milestone makes no throughput claim.

Refund creation and its success audit event are atomic. Refund reasons are stored in the fictional demo database but excluded from diagnostic logs and returned receipts. Handled tool outcomes are logged to stderr; malformed call envelopes bypass the handler's correlated outcome logging. Durable denied-attempt auditing is planned with the security gateway and requires a storage/retention decision before implementation.

## Verification

Local verification on September 11, 2026 passed type checking, six tests, and the SDK demo using installed dependencies. Five tests exercise the actual process boundary. The transaction test injects an audit failure and confirms there is no refund left behind. The wire harness rejects every stdout line that is not a valid, expected MCP message. A separate SDK-client demo verifies interoperability with the official client API. Full-restart verification of original refund/audit records remains planned; existing checks inspect those records while the first server is running.

## Current phase decisions and boundaries

The documentation name is BridgeLayer; package/server identifiers, `SUPPORTBRIDGE_DB`, the default database filename, and the workspace filename retain the earlier naming to keep current commands accurate. This documentation change does not rename runtime APIs.

The initial HTTP scenario will retain shared fictional customer records and make no tenant-data-isolation claim. Gateway/session design, downstream protection and credentials, authentication-error mapping, and audit persistence are still open design work. No HTTP gateway or authentication is partially implemented merely because those decisions are documented.
