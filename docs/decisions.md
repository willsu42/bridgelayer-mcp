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

Use built-in `node:sqlite` to avoid a native third-party database dependency. This API can emit an experimental warning on stderr; code was tested locally on Node 25.5.0, with Node 22/24 CI configured but remote execution unverified at that time (subsequently verified in the October 27 closeout). Keep synchronous transactions short. WAL and a busy timeout are configured; this milestone makes no throughput claim.

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

Verification on September 15 passed type checking, 23 tests/subtests, and the HTTP SDK-client demo on Node 25.5.0. The stdio persistence test now stops the original process and verifies its refund/audit records after restart. Token failures, denied execution, credential boundaries, malformed traffic, concurrency of request IDs, audits, sanitized failures, timeout, disconnect, and shutdown are exercised over real loopback HTTP. At that time, fresh installation, Node 24 execution, remote CI, hosted deployment, and broader SQLite throughput were unverified.

The earlier lack of Git metadata was an inspection limitation at that time. Git metadata is now available; this implementation has not rewritten or backdated commits.

Final recheck on September 16 (America/Chicago) passed type checking, all 23 tests/subtests, and the original stdio demo after the last request-cleanup adjustment. The HTTP demo had already completed on September 15. Fresh-install/recommended-runtime/remote-CI checks were still unverified at that September recheck.

## Task 2 closeout — October 27, 2026

Clean installation on Node 24.22.1 / npm 11.19.1, type checking, all 23 tests/subtests, and both HTTP/stdio demos passed. The existing GitHub CI run for `a744bfd` succeeded on Node 22 and 24; its results were inspected today, not rerun. [TASK2_CLOSEOUT.md](TASK2_CLOSEOUT.md) records exact installation conditions, runtime verification, CI links, and scope boundaries. Task 2 acceptance is complete; no application code or dependency pins changed. Automated retention, database capacity, hosting, and Tasks 3–4 remain separate work.

## Task 3 — Email-only stream inspection, October 28, 2026

The user confirmed email-only scope and authorized development. Use a separate authenticated `/guardrails/stream` path because the existing MCP gateway validates complete JSON responses. An injected deterministic mock supplies SSE bytes without external credentials. Hold whole whitespace tokens and redact them when a supported ASCII email substring is found; bounded oversize suppression avoids releasing ambiguous prefixes. This intentionally removes surrounding punctuation and can redact malformed addresses. The adapter contract requires abort cooperation, and errors never flush pending raw text.

No new dependency, database schema, model, or token-budget mechanism was introduced. [The walkthrough](03-streaming-guardrails-walkthrough.md) defines exact formats and lifecycle limits; [validation](TASK3_VALIDATION.md) records local checks and measurements. Remote Task 3 CI was unverified at the October 28 local implementation review; the October 29 closeout below resolves that gate. Existing MCP customer lookup still returns fictional email data and is not routed through this filter.

## Task 3 closeout — October 29, 2026

Verified existing GitHub Actions runs for implementation `6eb5604` and current revision `b0ef476`: both Node 22/24 jobs passed clean installation and `npm run check`. [TASK3_CLOSEOUT.md](TASK3_CLOSEOUT.md) records full commit IDs, run/job links, local evidence dates, and scope boundaries. Task 3 acceptance is complete; Task 4 design is next. This closeout changes documentation only and does not expand the email-only mock-provider scope.

## Task 4 — Token reservations and bounded fallback, November 1, 2026

The user requested Task 4 development. Adopt the roadmap defaults of 50,000 tokens per authenticated tenant over sixty seconds and a three-second first-usable-text deadline. Start with fixed synthetic input/output allowances and deterministic providers, preserving the earlier decision to defer live model integration. Use a separate `/resilient/stream` route and SQLite ledger so the existing Task 3 fixture contract and customer schema remain compatible.

Active reservations count in full regardless of the historical window. Known terminal usage replaces the reservation; missing usage charges it in full. A 120-second active lease exceeds the thirty-second overall request deadline, and expired leases become conservative unknown charges on the next ledger operation. One local SQLite transaction admits each attempt; backup admission follows primary cancellation and settlement. Unknown primary cost may therefore prevent fallback. Ledger failures never authorize a provider call.

Fallback is limited to one backup before any output, on primary rate limit or first-text timeout. Useful-text stalls and errors after output fail without switching models. Reuse the guardrail with fresh per-attempt state, and wait for handler settlement during gateway shutdown. [The walkthrough](04-token-budgets-and-fallback-walkthrough.md) defines exact policies and limits; [progress](TASK4_PROGRESS.md) records local evidence. Remote Task 4 CI was unverified at the November 1 implementation review; the November 3 closeout below resolves that gate.

## All-task closeout — November 3, 2026

The user requested closure of all tasks and a project explanation. Verified final implementation `dc381fa` against GitHub Actions run 41320833908: both Node 22/24 jobs passed `npm ci` and `npm run check`. [TASK4_CLOSEOUT.md](TASK4_CLOSEOUT.md) records exact evidence; [PROJECT_CLOSEOUT.md](PROJECT_CLOSEOUT.md) explains the system and consolidates acceptance for Tasks 1–4. This documentation-only closeout preserves the agreed mock-provider, fictional-data scope. Live models, UI, external integrations, and hosting are separate future work.

## Support Copilot Stage A — November 8, 2026

The user authorized Stage A of the commercial demonstration plan. Add a local English workbench with deterministic customer lookup and response drafting. Use the existing Node HTTP server tools, official MCP client, gateway, and streaming guardrail. Compile browser TypeScript separately without adding dependencies or changing the original fixture routes.

Start the workbench through `demo:copilot`, with fresh in-memory databases and separate random gateway/service credentials. Its session bootstrap grants only the fixed local demo viewer identity in an HttpOnly, SameSite=Strict cookie. Require exact same-origin POSTs, enforce strict request schemas, and limit active drafts to four. This intentionally convenient loopback bootstrap is not a production login. It must not be exposed as a public authentication service.

Lookup must succeed through the gateway before scripted generation starts. Select only ID, name, and plan from the result. Use a separately labeled sample email to demonstrate the existing output guardrail. Events describe observed workflow steps, never model reasoning. Cancel the source on stop, reset, disconnect, or shutdown, and suppress stale browser updates after reset.

Stage A has no live model, real token usage, or draft-route fallback. Task 4 remains a separate demonstration until a later integration phase establishes estimation and settlement for real generation inputs. The [Stage A walkthrough](COPILOT_STAGE_A.md) records current scope and local validation. Earlier task closeouts retain their dated scope and CI attribution.


## Support Copilot Stage B — November 9, 2026

The user authorized Groq Free-plan integration. Use the fixed Groq Chat Completions endpoint through native Node fetch, with no SDK retries, redirects, remote model tools, or implicit provider fallback. Start with `openai/gpt-oss-20b`; the server configuration also accepts `openai/gpt-oss-120b`. Both use low reasoning effort and `include_reasoning: false`. The adapter only forwards content deltas, normalizes bounded SSE, and requires a terminal finish reason plus `[DONE]`. Length-limited output remains incomplete.

Keep Scripted as the default and expose Live only when the server has a key. Free-plan enrollment and remaining quota belong to the Groq account; application code cannot establish billing status. Load secrets only from the server environment or ignored `.env`. No account upgrade, payment configuration, deployment, or external message sending is part of this change.

Reuse the Task 4 SQLite ledger with a distinct persistent file and an 8,000-token/sixty-second policy for the fixed authenticated demo tenant. Reserve UTF-8 message content bytes plus a 256-token chat-template margin and a 1,024-token output allowance before provider I/O. This conservative estimate is not a tokenizer result or a guaranteed provider quota bound. Settle terminal validated usage; unknown, interrupted, or malformed usage retains the full reservation. Over-reports are charged before failing closed. A successful response cannot precede settlement. Original fixture routers retain their existing three-second read timeout; live drafting allows ten seconds per read within the existing thirty-second total deadline.

The model receives verified customer name/plan and the question as data. Customer-record email is excluded. Output email filtering does not mask the input sent to Groq. The model has no tools and cannot send messages, approve refunds, or modify records; factual reliability still requires human review and a real-model evaluation. [Stage B documentation](COPILOT_STAGE_B.md) records setup, evidence, and outstanding live verification.


## Support Copilot Stage C — November 13, 2026

The user requested Stage C before completing broader Stage B answer-quality acceptance. Add a distinct `simulation` mode with a required allowlisted scenario: `rate-limit`, `timeout`, or `budget-exhausted`. Reject scenario fields on Scripted/Live requests so fault injection cannot silently affect real generation. Continue the authenticated, fixed customer lookup before the simulation begins.

Use a fresh in-memory `TokenBudget` per simulation and inject a local provider into the existing generation runner. The 429 fixture fails after 500 ms; the timeout fixture stalls until the real read deadline aborts it after 1.5 seconds; a one-token ledger fails reservation before a provider attempt. The simulator accepts no real provider, key, URL, or persistent ledger. It closes its temporary ledger on completion, cancellation, or consumer return. Live timeouts and persistent budgets retain their Stage B settings.

Mark simulated usage explicitly and report observed attempt counts, held allowances, and cancellation. These are local fixture observations, not real Groq errors, measured model tokens, or proof of live failover. Expected scenarios terminate with the actual error code and no draft `done` event. The UI recognizes an expected demonstration only after the matching finished observation and error; unexpected failures stay errors. Recovery is an explicit switch to Scripted followed by a new generation, with no hidden retry or fallback.

The [walkthrough](COPILOT_STAGE_C.md) includes the presentation script and local validation. The current scope remains local-only; no publication or public authentication is introduced.
