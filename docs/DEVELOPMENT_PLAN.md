# BridgeLayer — September 11 Phase Development Backlog

This backlog implements the planning structure approved for the phase beginning September 11, 2026. The initial sequencing window is September 11–24; dates are planning targets, not promises or records of daily work. [PROJECT_SCOPE.md](PROJECT_SCOPE.md) defines the bounded phase; [PROJECT_PLAN.md](PROJECT_PLAN.md) holds later workstreams.

Documentation reconciliation is implemented. All engineering items below remain planned; approval of this backlog does not imply their code exists or settle material architecture decisions. Security acceptance tests accompany gateway development even though they appear under P2.

## Inspection findings retained from the baseline review

| Finding | Evidence / implication |
| --- | --- |
| Local process access is the current trust boundary | No authentication, HTTP listener, or authorization exists. |
| Shared fictional customer model | No tenant column or tenant-filtered queries exist. Verified token claims alone cannot establish data isolation. |
| No refund idempotency contract | Every valid invocation creates another receipt; do not automatically retry refunds after network failures. |
| Incomplete restart evidence | Tests read refund/audit rows while the original server runs, then use another process for a seeded customer lookup. A complete restart with original refund/audit verification is missing. |
| Partial observability | Call-envelope parsing precedes the handler logging block; malformed envelopes bypass correlated outcomes. No duration field exists. |
| SQLite operational limits | Synchronous calls and a three-second busy timeout are configured; lock contention and dedicated signal/error shutdown tests are absent. |
| Database output typing | Customer rows are asserted as a TypeScript interface, not validated at runtime. Revisit at any imported-data boundary. |
| No schema migration mechanism | Startup creates tables if absent. Agree schema evolution before adding persistent audit or tenant structures. |
| Remote evidence unavailable | No Git metadata or established remote was available in this workspace; remote issues, historical commits, CI execution, and deployment were not verified. |

No TODO/FIXME/HACK markers were found in application/test source during the initial inspection. The gaps above come from code behavior, test coverage, and the existing roadmap; they are not all confirmed defects.

## P0 — Baseline / Documentation

### D0. Reconcile documentation and acceptance criteria

- **Status:** Implemented documentation in this phase.
- **Task:** Establish BridgeLayer naming, separate baseline/current/planned status, and distinguish the long-term plan from active-phase scope.
- **Why it matters:** Prevent historical work or proposed functionality from being presented as new completed implementation.
- **Existing baseline:** Earlier README, architecture, walkthrough, decision log, handoff, and September 11 scope/development proposal.
- **Expected change:** Coherent primary documents, explicit status matrix, phase milestones, and this P0–P3 backlog.
- **Files/components affected:** `README.md`, `PROJECT_PLAN.md`, `PROJECT_SCOPE.md`, `ARCHITECTURE.md`, this file, and supporting handoff/walkthrough/decision references.
- **Validation criteria:** Current claims trace to inspected behavior or dated checks; local links/case resolve; no historical backdating; setup identifiers match source.

## P1 — Core Development

### D1. Agree the HTTP/security design

- **Status:** Planned; first engineering discussion.
- **Task:** Specify the gateway/service boundary, HTTP sessions, downstream credentials/protection, token claims, errors, and audit decisions.
- **Why it matters:** The reusable store is ready, but network trust and lifecycle rules are not defined by stdio.
- **Existing baseline:** Customer handlers/store over stdio and an existing gateway roadmap.
- **Expected change:** Reviewable request sequence, allow/deny matrix, and decision records. Preserve shared fictional data without claiming tenant isolation.
- **Files/components affected:** `docs/decisions.md`, `docs/ARCHITECTURE.md`; proposed HTTP/gateway interfaces.
- **Validation criteria:** Design review resolves downstream bypass protection, session-to-caller association, no bearer-token passthrough, error correlation, and refund retry policy before implementation.

### D2. Add the HTTP service and gateway integration

- **Status:** Planned; depends on D1.
- **Task:** Add the customer HTTP MCP entry point, gateway plumbing, and harmless mock admin tool while retaining stdio.
- **Why it matters:** Supplies the next API integration boundary using existing business logic.
- **Existing baseline:** Two MCP tools, Zod schemas, SQLite store, and scripted stdio client.
- **Expected change:** HTTP initialization/discovery/calls connected to the same customer behavior. D4 security controls and tests accompany this work.
- **Files/components affected:** `src/mcp/`, a proposed gateway module, new HTTP integration tests, and demo scripts. Exact new filenames/framework decisions are not selected here.
- **Validation criteria:** HTTP client initializes, lists tools, looks up customers, and creates simulated refunds; current stdio tests and error contracts remain valid.

## P2 — Reliability / Security

### D3. Prove persistence across a complete restart

- **Status:** Planned; perform early, before extending service behavior.
- **Task:** Create a refund, stop the original server, restart on the same database, and inspect original refund/audit records.
- **Why it matters:** Closes a specific persistence-evidence gap.
- **Existing baseline:** On-disk SQLite, atomic writes, and checks performed while the original process remains alive.
- **Expected change:** A meaningful process-restart regression.
- **Files/components affected:** `tests/mcp.test.ts`; store changes only if the regression reveals a defect.
- **Validation criteria:** Original refund ID, amount, reason, and linked audit event survive; existing tests pass; temporary test databases are cleaned up.

### D4. Implement and prove authentication/authorization

- **Status:** Planned; implement with D2 after D1.
- **Task:** Validate signed demo-token claims and enforce the planned `admin_` tool-execution policy.
- **Why it matters:** HTTP exposure needs an explicit enforced trust boundary.
- **Existing baseline:** No authentication; execution policy is documented only.
- **Expected change:** Signature, issuer, audience, expiry, role, and tenant-claim validation; authenticated discovery remains unfiltered.
- **Files/components affected:** Proposed gateway/authentication code, HTTP integration tests, mock admin tool.
- **Validation criteria:** Missing/invalid/expired tokens fail; non-admin execution returns exactly `-32001: Unauthorized Tool Call` with the request ID; admin execution succeeds; spies prove denied calls never execute downstream and inbound bearer tokens never reach the service. Shared fixtures are not described as tenant-isolated data.

### D5. Harden failures and observability

- **Status:** Planned; relevant existing-log coverage can precede HTTP work.
- **Task:** Define bounded downstream failure/cancellation behavior; add correlated outcomes/durations and malformed-envelope logging coverage. Agree durable denial-audit storage/retention before schema changes.
- **Why it matters:** Diagnose failures without exposing sensitive values or replaying refund writes.
- **Existing baseline:** Sanitized service errors, basic stderr logs, success-only database audits, and rollback tests.
- **Expected change:** Tested downstream unavailability/timeout/malformed-response handling, consistent request diagnostics, and an explicit denial-audit decision.
- **Files/components affected:** `src/mcp/server.ts`, `src/mcp/stdio.ts` where lifecycle work is needed, `src/logger.ts`, gateway, tests; store only if persistent auditing is agreed.
- **Validation criteria:** Failures complete within the agreed bound; request correlation survives where possible; cancellation/shutdown cases are tested; no automatic refund replay; logs omit tokens, customer records, and reasons; stdout remains protocol-only. If denial auditing is implemented, prove it persists without creating a refund.

## P3 — Demonstration

### D6. Deliver the local HTTP demo and operating guide

- **Status:** Planned; depends on a tested gateway.
- **Task:** Document and demonstrate allowed/denied flows, startup/configuration, storage, and shutdown.
- **Why it matters:** Make the integration independently reproducible.
- **Existing baseline:** Working stdio demo, npm commands, and VS Code child-process debugging.
- **Expected change:** HTTP examples and a local runbook based on actual implementation.
- **Files/components affected:** Demo scripts, README, architecture/runbook, and VS Code configuration if needed.
- **Validation criteria:** A clean local setup follows documented commands and exercises success/denial; database location and lifecycle are explicit. Verify the recommended Node 24 runtime when available; record CI results only after an actual run. No hosted deployment is claimed.

## Sequencing and deferred work

Suggested order: D0 → D1 and D3 → D2 with D4 → D5 → D6. Prioritize design, baseline evidence, and gateway behavior in the first week; continue security/failure validation and demonstration in the second as capacity permits. Do not compress the acceptance checks to fit a date.

The immediate data integration is SQLite, and the next API boundary is HTTP MCP. Streaming PII, token reservations/fallback, React, live agents, new external data vendors, and hosted deployment remain outside the initial delivery. A later read-only agent proposal should specify expected tool choices, invalid/missing customer cases, tool errors, and bounded execution before selecting a provider.

## Reconciliation record

The approved documentation proposal resolves these discrepancies without changing source behavior:

| Previous state | Reconciled state |
| --- | --- |
| User requested BridgeLayer; repository prose used SupportBridge | BridgeLayer is the documentation name; earlier name and executable identifiers are explicitly preserved. |
| No long-term `PROJECT_PLAN.md`; scope repeated later roadmap | Dedicated long-term plan; active scope limited to gateway and supporting work. |
| Lowercase `architecture.md` and ambiguous present-tense mock admin description | Canonical `ARCHITECTURE.md`, updated links, and explicit component statuses. |
| README led with assessment tasks | Problem, current capabilities, workflow, setup, evidence, and roadmap lead the presentation. |
| Broad logging/persistence claims | Malformed-call logging and full-restart test gaps are explicit. |
| Handoff categorical remote/credential statements | Historical context and current evidence limits are distinguished. |
| Earlier backlog priority structure / README recommendations | Approved P0–P3 backlog; README recommendations applied rather than left as pending text. |

No code-versus-doc conflict was found suggesting SQLite was absent, Python was the implementation language, or gateways were already running. The historical decision log retains the origin of the explicit error contract using FDE scenario wording.

Local validation recorded September 11: type checking, six tests, and SDK demo passed on Node 25.5.0 / npm 11.8.0 using installed dependencies. No new application code was changed or new runtime tests claimed by this documentation reconciliation. No Git history was rewritten or initialized, and no historical timestamps were backdated.
