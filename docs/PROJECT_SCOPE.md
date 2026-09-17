# BridgeLayer — Active Development Phase Scope

| Field | Value |
| --- | --- |
| Project name | BridgeLayer (previous prototype name: SupportBridge) |
| Project type | Independent Software / AI Development |
| Developer | Yu-Chen Su (preferred name: Will) |
| Role | Independent Software & AI Consultant |
| Current development phase start date | September 11, 2026 |
| Scenario | Customer-inspired FDE integration case study; fictional data and simulated refunds |
| Initial planning window | September 11–24, 2026; sequencing target, not a delivery promise |

BridgeLayer builds on an existing FDE/MCP prototype. The current active development phase began on September 11, 2026 and focuses on extending, hardening, testing, and documenting the existing system. The project itself predates this phase. No actual client engagement or external customer adoption is evidenced.

## Problem and intended use case

Expose customer-support data and simulated operations through discoverable, validated MCP tools, then extend the existing local process boundary to an explicitly controlled HTTP integration. The reference workflow is customer lookup followed by a simulated refund. Today it is exercised by a developer-operated scripted client; a support-operator UI does not exist.

## Existing Baseline

Before this phase, the prototype already had:

- One TypeScript MCP server over stdio, tool discovery, and two tools: customer lookup and simulated refunds.
- Strict Zod input validation, explicit protocol/business error mapping, and sanitized unexpected errors.
- On-disk SQLite with fictional customer seeds, integer-cent refunds, and atomic refund/success-audit writes.
- Structured stderr diagnostics, with the coverage gaps described in the architecture.
- Six automated tests, an official SDK-client demo, VS Code debugging, and technical/learning documentation.
- A Node 22/24 CI workflow definition; remote execution is unverified.

This attribution is based on the developer's statement and the September 8 inspection recorded in the accompanying conversation. Git metadata was absent in the initial inspection; it is now present. The earlier evidence limitation is retained as history, and no historical commits or timestamps are rewritten or backdated by this work.

The September 11 phase has added scope/backlog documentation, the BridgeLayer documentation name, Task 2's HTTP/security gateway, and stronger restart validation. Task 2 was locally validated on September 15, 2026. No AI implementation has been added.

## Current Development Objectives

1. Maintain an accurate baseline and separate implemented, partial, missing, and planned capabilities.
2. Strengthen evidence for refund/audit persistence through a complete process restart.
3. Agree the HTTP gateway design and implement a bounded integration using the existing handlers/store.
4. Verify authentication, authorization, downstream failures, and relevant diagnostic coverage.
5. Demonstrate the resulting local workflow with reproducible instructions and clear limits.

## In Scope

- Documentation reconciliation and the BridgeLayer documentation name, preserving working runtime identifiers.
- Existing-service regression tests and relevant reliability improvements.
- An HTTP MCP customer-service entry point and security gateway, while preserving stdio.
- Signed demo-token validation and the existing planned `admin_` execution policy.
- A harmless admin test tool, zero-downstream-execution denial tests, and token-boundary verification.
- Bounded downstream failures, correlated logs, and a denial-audit design; implementation follows agreement on storage/retention.
- A local allowed/denied demo, setup/operating instructions, and developer experience improvements needed to run them.

The implemented scenario uses shared fictional records with no row-level tenant isolation. HTTP is stateless, downstream protection uses a separate service credential, and denials use a separate SQLite database. Decisions and remaining operational limits are recorded in [decisions.md](decisions.md) and the [HTTP walkthrough](02-http-gateway-walkthrough.md).

## Out of Scope

Later phases cover streaming PII guardrails, token reservations, model fallback, the React console, live LLM/agent execution, external customer API vendors, and hosted deployment. Real payments, production customer data, a complete OAuth authorization server, multi-host scaling, and a tenant-aware customer data-model redesign are outside this initial delivery.

Detailed later workstreams belong in [PROJECT_PLAN.md](PROJECT_PLAN.md), not this phase's completion criteria. No new provider, model, framework, client, or production outcome is committed.

## Deliverables and Validation Criteria

| Deliverable | Current status | Validation criteria |
| --- | --- | --- |
| Reconciled README, plan, scope, architecture, and backlog | Implemented documentation in this phase | Current claims trace to inspected code/evidence; planned work is labeled; local links and filename casing resolve. |
| Full-restart refund/audit regression | Implemented and tested September 15 | Original receipt values and linked audit survive stopping/restarting the server. |
| HTTP/security design | Implemented and documented | Stateless requests, separate service credential, constrained JWT claims, shared fixtures, bounded errors, separate denial database. |
| HTTP service and gateway | Implemented and tested | HTTP initialization, discovery, lookup, and simulated refund work; stdio checks remain green. |
| Authentication/authorization evidence | Implemented and tested | Invalid tokens fail; exact admin denial preserves ID; allowed calls work; spies prove zero downstream denial execution and no inbound bearer passthrough. |
| Failure handling and observability | Implemented and tested locally | Invalid replies/timeouts/disconnects/shutdown are covered; no retries; gateway logs have correlation/duration and omit sensitive fields. |
| Local demonstration/runbook | Implemented; demo verified with installed dependencies | Official-client demo reproduces allowed/denied paths; configuration/lifecycle documented. Fresh installation and Node 24 validation remain open. |

Security tests accompany gateway implementation. A design approval or documentation update alone does not change any planned row to implemented.

## Tech Stack and Architecture Summary

The application uses TypeScript 7.0.2, Node.js ES modules, MCP SDK 1.30.0, Zod 4.5.4, jose 6.2.12, built-in HTTP/SQLite, npm, and Node's test runner. Node 24 is specified by `.nvmrc`; the minimum is 22.13.0. No application HTTP framework, React app, or LLM SDK is introduced.

Both request paths exist: scripted client → stdio → customer handlers/store, and HTTP client → security gateway → protected HTTP customer service → the same handlers/store. Customer data and gateway denials use separate SQLite files. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Testing / Validation Baseline

On September 11, 2026, `npm run check` passed strict type checking and all six tests; `npm run demo` completed discovery, lookup, a simulated 1250-cent refund, and invalid-amount rejection. This used installed dependencies on Node 25.5.0 / npm 11.8.0. SQLite's experimental warning appeared on stderr without breaking protocol checks.

Those checks preceded Task 2 and remain historical baseline evidence. On September 15, type checking, 23 tests/subtests, and the HTTP demo passed locally on Node 25.5.0. The full-restart regression is now included. A fresh install, Node 24 run, remote CI, production performance, and AI evaluations remain unverified.

## Milestones

| Milestone | Status | Exit condition |
| --- | --- | --- |
| M0 — Documentation baseline | Implemented documentation | Approved naming and status reconciliation, coherent document roles, verified local references. |
| M1 — Design and regression evidence | Implemented | Design recorded and full-restart test passes. |
| M2 — HTTP/security integration | Implemented locally | Service/gateway and allow/deny checks pass alongside stdio regressions. |
| M3 — Hardening and demonstration | Implemented locally; environment validation remains | Failure/logging criteria and HTTP demo pass; clean-install/Node 24/remote CI evidence remains open. |

The initial September 11–24 planning window remains historical context, not a record of daily work or promised completion. The [development backlog](DEVELOPMENT_PLAN.md) distinguishes completed Task 2 behavior from remaining environment and operational validation.

Development continues through explain → agree → implement → demonstrate → practice explaining back in VS Code. Next, review the Task 2 request path and practice explaining its trust boundaries before designing Task 3.
