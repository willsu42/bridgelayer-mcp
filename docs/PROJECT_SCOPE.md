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

This attribution is based on the developer's statement and the September 8 inspection recorded in the accompanying conversation. The inspected workspace has no `.git` metadata, so commit dates and historical diffs could not be audited. No historical Git commits or timestamps are rewritten or backdated by this documentation change.

The September 11 phase has so far added scope/backlog documentation, renewed local validation, and this approved documentation reconciliation/name change. It has not yet added gateway, authentication, or AI implementation.

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

The initial scenario uses shared fictional customer records. Tenant claims must not be described as row-level data isolation. HTTP sessions, downstream credentials/protection, failure semantics, and any audit schema changes remain material design decisions to settle before implementation.

## Out of Scope

Later phases cover streaming PII guardrails, token reservations, model fallback, the React console, live LLM/agent execution, external customer API vendors, and hosted deployment. Real payments, production customer data, a complete OAuth authorization server, multi-host scaling, and a tenant-aware customer data-model redesign are outside this initial delivery.

Detailed later workstreams belong in [PROJECT_PLAN.md](PROJECT_PLAN.md), not this phase's completion criteria. No new provider, model, framework, client, or production outcome is committed.

## Deliverables and Validation Criteria

| Deliverable | Current status | Validation criteria |
| --- | --- | --- |
| Reconciled README, plan, scope, architecture, and backlog | Implemented documentation in this phase | Current claims trace to inspected code/evidence; planned work is labeled; local links and filename casing resolve. |
| Full-restart refund/audit regression | Planned | Create a refund, stop the server, restart against the same database, and verify original receipt values and linked audit; existing tests remain green. |
| Agreed HTTP/security design | Planned | Request sequence and allow/deny matrix specify sessions, downstream protection, token claims, shared-data semantics, errors, and audit decisions. |
| HTTP service and gateway | Planned | HTTP initialization, discovery, lookup, and simulated refund work; existing stdio behavior remains tested. |
| Authentication/authorization evidence | Planned | Invalid/expired tokens fail; viewer admin calls yield `-32001: Unauthorized Tool Call` with the same ID; allowed calls succeed; denied requests and inbound bearer tokens never reach the downstream service. |
| Failure handling and observability | Planned | Bounded downstream failure/cancellation behavior; correlated sanitized outcomes; no automatic refund replay; diagnostic logs omit tokens, customer records, and reasons. |
| Local demonstration/runbook | Planned | Documented startup/configuration/shutdown commands reproduce allowed and denied flows, with database location and limitations explicit. |

Security tests accompany gateway implementation. A design approval or documentation update alone does not change any planned row to implemented.

## Tech Stack and Architecture Summary

The existing application uses TypeScript 7.0.2, Node.js ES modules, MCP SDK 1.30.0, Zod 4.5.4, built-in synchronous SQLite, npm, and Node's test runner. Node 24 is specified by `.nvmrc`; the package minimum is 22.13.0. No HTTP framework, React application, or LLM SDK is used by application source today.

Current flow: scripted MCP client → stdio transport → handlers → Zod → customer store → SQLite. Diagnostics go to stderr; stdout carries protocol responses. The planned next boundary is gateway → HTTP customer service, reusing business logic. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Testing / Validation Baseline

On September 11, 2026, `npm run check` passed strict type checking and all six tests; `npm run demo` completed discovery, lookup, a simulated 1250-cent refund, and invalid-amount rejection. This used installed dependencies on Node 25.5.0 / npm 11.8.0. SQLite's experimental warning appeared on stderr without breaking protocol checks.

These checks preceded this documentation reconciliation. No application behavior changed in the reconciliation. A fresh install, remote CI, a full-restart refund regression, production performance, and AI-quality evaluations were not verified by those runs.

## Milestones

| Milestone | Status | Exit condition |
| --- | --- | --- |
| M0 — Documentation baseline | Implemented documentation | Approved naming and status reconciliation, coherent document roles, verified local references. |
| M1 — Design and regression evidence | Planned | HTTP/security decisions agreed and full-restart test passes. |
| M2 — HTTP/security integration | Planned | New service/gateway and allow/deny integration checks pass alongside stdio regression tests. |
| M3 — Hardening and demonstration | Planned | Failure/logging criteria pass and local demo/runbook is reproducible. |

The first one to two weeks should prioritize M1 and M2, then M3 as capacity permits. Dates are planning windows, not records of daily work or promised completion. The actionable [development backlog](DEVELOPMENT_PLAN.md) maps tasks to affected components and evidence.

Development continues through explain → agree → implement → demonstrate → practice explaining back, with code discussion in VS Code. This document approves direction; it does not settle the remaining architectural decisions.
