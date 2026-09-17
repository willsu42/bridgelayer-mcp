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

Refund creation and its success audit event are atomic. Refund reasons are stored in the fictional demo database but excluded from diagnostic logs and returned receipts. Handled tool outcomes go to stderr. The gateway now correlates malformed-envelope errors even when the SDK rejects a call before the customer handler; stdio retains that diagnostic limitation. Task 2 adds a separate durable denial database as described below.

## Verification

Local verification on September 11, 2026 passed type checking, six tests, and the SDK demo using installed dependencies. Five tests exercise the actual process boundary. The transaction test injects an audit failure and confirms there is no refund left behind. The wire harness rejects every stdout line that is not a valid, expected MCP message. A separate SDK-client demo verifies interoperability with the official client API. Full-restart verification of original refund/audit records remains planned; existing checks inspect those records while the first server is running.

## Current phase decisions and boundaries

The documentation name is BridgeLayer; package/server identifiers, `SUPPORTBRIDGE_DB`, the default database filename, and the workspace filename retain the earlier naming to keep current commands accurate. This documentation change does not rename runtime APIs.

The implemented HTTP scenario retains shared fictional customer records and makes no tenant-data-isolation claim. The following Task 2 decisions were explained during the requested implementation and are now reflected in code and tests.

## Task 2 — HTTP security gateway, September 15, 2026

- **Stateless HTTP:** use the pinned SDK's Streamable HTTP transport with JSON responses and a fresh server/transport per POST. No session identifiers, GET SSE stream, or server-initiated requests are needed for these synchronous customer tools. No protocol-version upgrade is implied.
- **Local topology:** two loopback HTTP listeners in one Node process, backed by the same customer store. A separate service key protects direct HTTP access. This is a network credential boundary, not OS-process isolation; stdio remains independently available.
- **Authentication:** promote the already installed jose version 6.2.12 to a direct pinned dependency. Use HS256 demo JWTs with explicit algorithm/type, issuer, audience, subject, issued-at, expiry, role, and tenant validation. Lifetime is at most 15 minutes. Local token issuance requires the signing secret; no login/OAuth authorization server is claimed.
- **Authorization:** authenticated discovery is unfiltered. Non-admin calls to any `admin_` tool return exactly `-32001: Unauthorized Tool Call` with the request ID. Denied notifications receive empty HTTP 202 and never execute downstream. The HTTP-only `admin_health_check` tool is harmless; viewers may still create simulated refunds.
- **Credential forwarding:** build downstream headers from an allowlist using a different service credential. Never forward inbound bearer tokens, cookies, or caller-supplied service keys. The target is a fixed loopback /mcp URL; redirects are rejected.
- **Request boundary:** validate exact local Host and any Origin; accept one JSON message per POST; reject batches and fake sessions. Input is capped at 64 KiB with a three-second body timeout; downstream JSON at 1 MiB.
- **Failures:** invalid credentials yield HTTP 401 before reading body data. Downstream invalid/unavailable replies and local audit failure produce sanitized HTTP 502 / -32002. Three-second downstream timeout yields HTTP 504 / -32003 and an unknown-operation-outcome message. Client disconnect/shutdown aborts waiting; no automatic refund replay or guarantee of undoing committed writes.
- **Denial audit:** use a separate SQLite file/table, preserving Task 1's customer schema. Store only random event ID, timestamp, request ID when available, and stable denial code. No tokens, identity claims, tool arguments, records, or reasons. Audit failure blocks forwarding. There is no automatic deletion/retention job or audit API; the operator manages the local demo database explicitly.
- **Diagnostics:** gateway requests and handled customer calls record outcomes/durations without secret fields. Gateway logs cover malformed tool calls even when the SDK rejects them before the customer handler.
- **Strict typing:** the pinned SDK declares optional fields inconsistently between its HTTP transport classes and Transport interface. Localized assertions bridge those compatible SDK types; project-wide strict compiler flags are retained.

Verification on September 15 passed type checking, 23 tests/subtests, and the HTTP SDK-client demo on Node 25.5.0. The stdio persistence test now stops the original process and verifies its refund/audit records after restart. Token failures, denied execution, credential boundaries, malformed traffic, concurrency of request IDs, audits, sanitized failures, timeout, disconnect, and shutdown are exercised over real loopback HTTP. Fresh installation, Node 24 execution, remote CI, hosted deployment, and broader SQLite throughput remain unverified.

The earlier lack of Git metadata was an inspection limitation at that time. Git metadata is now available; this implementation has not rewritten or backdated commits.

Final recheck on September 16 (America/Chicago) passed type checking, all 23 tests/subtests, and the original stdio demo after the last request-cleanup adjustment. The HTTP demo had already completed on September 15. Fresh-install/recommended-runtime/remote-CI checks remain explicitly unverified.
