# BridgeLayer — Long-Term Project Plan

BridgeLayer is an independent software and AI development project based on customer-inspired FDE integration scenarios. The personal prototype, previously named SupportBridge, existed before the active professional phase beginning September 11, 2026. This roadmap describes intended engineering work, not a client engagement or a completion record.

The four workstreams remain appropriate to the current architecture. Phase commitments belong in [PROJECT_SCOPE.md](PROJECT_SCOPE.md); individual work items belong in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md). [ARCHITECTURE.md](ARCHITECTURE.md) describes implemented boundaries and planned extensions.

## Status conventions

- **Implemented:** working code or an existing artifact supports the claim.
- **Partial:** a capability exists with identified gaps; this does not imply new implementation has started.
- **Missing:** absent and not committed as an implementation milestone.
- **Planned:** documented future functionality with no implementation.

“In Progress” below identifies ongoing work, not intentions. Task 2 is now implemented and locally tested, with verification dated September 15, 2026. No later workstream has started.

## Documentation status matrix

Pre-September 11 attribution uses the developer's statement and September 8 inspection in the development conversation. No Git history was available to independently establish commit dates.

| Capability | Repo status | Existing before 9/11 | Current phase | Planned |
| --- | --- | --- | --- | --- |
| MCP server and stdio | Implemented | Yes | Compatibility retained | — |
| Two customer tools and discovery | Implemented | Yes | HTTP entry point added | — |
| HTTP admin health test tool | Implemented | No | Added with Task 2; stdio still has two tools | — |
| Zod validation / error mapping | Implemented | Yes | Preserve contracts | HTTP boundary tests |
| SQLite and atomic refund/audit writes | Implemented | Yes | Full-restart regression added | — |
| Separate SQLite denial audit | Implemented | No | Added with Task 2 | Automated retention not implemented |
| Scripted SDK client | Implemented | Yes | Extend demo later | HTTP allowed/denied flows |
| Six original stdio tests | Implemented | Yes | Restart coverage strengthened | — |
| HTTP integration/failure tests | Implemented | No | 23 total tests/subtests now pass locally | Additional environment validation |
| Logging / observability | Partial | Basic logs: yes | Gateway correlation/durations and denial audit added | Centralized metrics not implemented |
| Node 22/24 CI workflow definition | Implemented | Yes | Verify when runnable | — |
| Verified remote CI results | Missing | Not established | Record actual results | — |
| HTTP security gateway / authentication | Implemented | No | Signed demo tokens, role policy, separate downstream credentials | Production OAuth outside current scope |
| Streaming PII guardrail | Planned | No | Later phase | Incremental stream inspection |
| Token limiter / model fallback | Planned | No | Later phase | Reservations and routing |
| LLM calls / autonomous agents | Missing | No | Out of initial scope | Candidate extension |
| React console | Planned | No | Later phase | Backend-driven demo UI |
| Hosted deployment / external customer APIs | Missing | No evidence | Local runbook only | Separate decision |
| Phase scope and development documentation | Implemented | No | Established this phase | Maintain evidence |

## 1. MCP Server & Tool Integration

### Existing

One official SDK server over stdio exposes `get_customer_record` and `trigger_refund`. It advertises tool schemas, validates arguments with Zod, applies customer/whole-cent business checks, and persists simulated refunds plus success audits atomically in SQLite. The SDK client demo, six tests, VS Code workflow, and diagnostics already existed before September 11.

No MCP resources or prompt handlers are registered. The demo is scripted; no model chooses its tool calls.

### In Progress

No additional work is in progress. Task 2 has added HTTP access and a full-restart regression while retaining stdio behavior.

### Planned

Continue maintaining the service. The HTTP entry point, original-record restart regression, and gateway logging/failure coverage are now implemented. Broader SQLite lock-contention measurement and imported-data validation remain future improvements; no external CRM or ticketing vendor is selected.

Acceptance: existing tests remain green; original refund/audit records survive restart; an HTTP client can initialize, discover, and call the existing tools once the new entry point is implemented.

## 2. MCP Security Gateway

### Existing

Task 2 is implemented: stateless HTTP MCP service, JWT-authenticated gateway, separate service credential, HTTP-only harmless admin tool, minimal SQLite denial audit, bounded proxy failures/cancellation, and correlated diagnostics. The local launcher runs two loopback listeners in one process. Customer records remain shared; there is no tenant data isolation.

### In Progress

None. Implementation and local acceptance checks are complete; see the [Task 2 walkthrough](02-http-gateway-walkthrough.md) for configuration and current limits.

### Planned

Further environment validation and operational hardening may follow: recommended Node 24, clean dependency installation, remote CI, and an explicit automated audit-retention policy. Full OAuth, tenant-aware customer data, real-payment authority, and hosted operation remain outside this implementation.

The original workstream acceptance criteria are now covered locally: unfiltered authenticated discovery; signature/issuer/audience/lifetime/role/tenant validation; exact `-32001: Unauthorized Tool Call` with matching ID; zero downstream execution on denial; no bearer-token passthrough; service-credential protection; sanitized failures; cancellation without retries; and persistent denial records.

## 3. LLM Streaming Guardrails

### Existing

None. No provider adapter, streamed LLM output, or redaction implementation exists.

### In Progress

None; outside the initial September 11 phase delivery.

### Planned

Separate byte decoding, provider-event parsing, and incremental text inspection. Start with deterministic provider mocks. Test every split position for supported sensitive patterns, multiple events per chunk, escaped text, Unicode boundaries, final flush, cancellation, and slow consumers.

Keep ambiguity buffers bounded. Suppress oversized ambiguous sequences conservatively until a safe boundary. Document supported formats and false-positive/false-negative limits. No provider or model is selected.

Acceptance: deterministic streaming cases pass; report measured time to first safe output, added redaction latency, and peak buffer size. No such measurements exist yet.

## 4. Rate Limiting & Model Fallback

### Existing

SQLite is available infrastructure. There are no budget tables, reservation logic, usage reconciliation, provider calls, or routing/fallback implementation.

### In Progress

None; outside the initial September 11 phase delivery.

### Planned

The existing roadmap proposes a per-tenant rolling 60-second budget, initially 50,000 tokens. Authenticate tenant identity rather than accepting an arbitrary request field. Reserve estimated input plus output allowance atomically before dispatch, reconcile actual usage, and track attempts. Separate live reservation lifetimes from historical usage expiry so long streams retain their reservations. Define a conservative policy for unknown usage.

The proposed timeout is 3,000 ms until first usable upstream text. A primary 429 or qualifying timeout would cancel the primary and allow one backup attempt before output reaches the client. Define a separate policy for stalls after output begins; never silently join partial primary output to a new backup answer. These values and policies require design confirmation before implementation.

Acceptance: test parallel admissions, exact window boundaries, cleanup, restart behavior, success/timeout races, late primary responses, backup failure, and errors after streaming begins. Use short SQLite transactions with explicit busy handling; make no multi-host scaling claim.

## Later demonstration and extension candidates

The planned React console will exercise actual backend behavior for fictional lookup/refunds, viewer/admin differences, synthetic PII, provider failure injection, budgets, and request traces. It is not installed or implemented.

Live agents are a separate candidate after gateway behavior is established. A bounded read-only lookup flow and explicit evaluation cases would be a reasonable first proposal; no agent framework or provider is selected. Real external APIs and hosting similarly require an agreed source/target, contract, credentials, and validation plan before implementation.

## Evidence and historical integrity

The pre-phase service was exercised in the September 8 review. On September 11, local type checking, six tests, and the demo passed using Node 25.5.0 and installed dependencies. Remote CI and a fresh dependency installation were not verified.

Git metadata was absent during the initial inspection but is now present. The Task 2 work does not initialize, rewrite, or backdate history. BridgeLayer remains the documentation name; runtime identifiers retain SupportBridge naming for compatibility.

On September 15, 2026, type checking, 23 tests/subtests, and the HTTP SDK demo passed on Node 25.5.0 using installed dependencies. This is new-phase evidence, separate from the earlier six-test baseline. A fresh install, Node 24 execution, remote CI, and deployment remain unverified.
