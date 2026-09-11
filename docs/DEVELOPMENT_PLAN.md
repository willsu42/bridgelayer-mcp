# SupportBridge — September 11–24, 2026 Development Proposal

This plan accompanies [PROJECT_SCOPE.md](PROJECT_SCOPE.md). It prioritizes the next one to two weeks of the independent professional development phase. Estimates are focused development time, not delivery promises. Proposed work is not implemented or automatically approved by inclusion here.

## Inspection findings

The working baseline is one TypeScript MCP server with two tools over stdio, a SQLite store, a scripted SDK client, six tests, and JSON stderr logs. No actual client engagement, live external API integration, LLM call, autonomous agent workflow, HTTP listener, or deployed service was evidenced. Tasks 2–4 and the React console appear in the existing roadmap only.

No `TODO`, `FIXME`, or `HACK` markers were found in the inspected application/test source. Incomplete work is primarily tracked in [architecture.md](architecture.md), [decisions.md](decisions.md), and the README status/limits sections. Remote issues and historical commits could not be inspected because this workspace has no Git metadata or established remote. Do not interpret that as evidence that no original repository exists elsewhere.

| Finding | Evidence and consequence |
| --- | --- |
| Local process access is the current trust boundary | No authentication or authorization exists. Add and test gateway policy before treating the service as a network-accessible integration. |
| No tenant data model exists | The `customers` table has no tenant identifier. Verifying a tenant claim alone would not establish customer-data isolation. Agree whether Task 2 remains a shared fictional dataset or requires a separately designed tenant-aware store. |
| Refund retry semantics are intentionally incomplete | Every valid call writes a new refund. Neither request IDs nor identical arguments provide deduplication. HTTP failures must not trigger automatic refund retries without a new idempotency contract. |
| Persistence evidence can be stronger | The existing test reads refund/audit rows while the original server is running, then launches another process that retrieves a seeded customer. It does not stop the original process and verify the same refund/audit rows after restart. |
| Logging coverage has a specific gap | `CallToolRequestSchema.parse(request)` occurs before the handler's `try` block, so malformed tool-call envelopes bypass its `tool.call` outcome logging. Generic protocol logging does not provide an equivalent correlated outcome. No duration field is currently recorded. |
| SQLite scalability and operational behavior are unmeasured | Synchronous calls can block the event loop; a three-second busy timeout is configured. Lock contention, concurrent refund admissions, and signal/error shutdown behavior lack dedicated tests. |
| Store typing relies on a database assertion | `getCustomer()` casts a SQLite row through `unknown` to `Customer`; this is not runtime output validation. The current controlled schema limits exposure, but a future imported-data adapter should have an explicit validation boundary. |
| Schema evolution is not implemented | Startup uses `CREATE TABLE IF NOT EXISTS` and seeding, with no versioned migration mechanism. Revisit this if gateway auditing or tenant changes alter persistent tables. |
| Remote validation and deployment remain unevidenced | A Node 22/24 workflow exists, but no remote run was inspected. No hosting or deployment configuration is present. |

These are observed limits and coverage gaps, not a claim that every untested path is defective.

## Prioritized backlog

The primary two-week outcome should be a tested Task 2 gateway and clear operational documentation. Keep the agent work to a bounded design/evaluation proposal if gateway work consumes the available time. Defer lower-priority items rather than compressing security and regression validation.

| Order | Priority / timing | Proposed work | Completion evidence / dependency |
| --- | --- | --- | --- |
| 1 | P0 · Week 1 · 0.5 day | Agree the Task 2 design in the decision log: HTTP transport/session model, gateway/service boundary, signed demo-token validation, tenant meaning, downstream credentials, and error mapping. | Reviewable request sequence and allow/deny matrix. Resolve shared fictional data versus actual tenant isolation; no implementation before material decisions are agreed. |
| 2 | P0 · Week 1 · 0.5–1 day | Strengthen the existing persistence regression before extending the service. | Create a refund, stop the server, reopen the same database with a fresh process, and verify the original refund ID, cents, reason, and linked audit event remain. Existing checks still pass. |
| 3 | P0 · Week 1 · 1–2 days | Add the customer service HTTP MCP entry point and a harmless mock `admin_` tool, reusing existing validation/business logic. | Real HTTP client completes initialization, discovery, lookup, and simulated refund; stdio remains working. No arbitrary framework choice or business-contract rewrite. Depends on item 1. |
| 4 | P0 · Weeks 1–2 · 2 days | Implement the security gateway from the agreed design. Validate signature, issuer, audience, expiry, role, and tenant claim; preserve request correlation. | Missing/invalid/expired tokens rejected; authenticated tool discovery unfiltered; viewer `admin_` call returns exactly `-32001: Unauthorized Tool Call`; admin path succeeds; a downstream spy proves denied calls never execute and inbound bearer tokens never reach it. Depends on items 1 and 3. |
| 5 | P1 · Week 2 · 1 day | Define and test gateway reliability: downstream unavailability, timeout, malformed response, and shutdown/cancellation cleanup. | Bounded failure completion, sanitized responses, correlation retained where possible, and no automatic replay of `trigger_refund`. Evaluate SQLite contention separately from network timeout behavior. Depends on gateway implementation. |
| 6 | P1 · Week 2 · 0.5–1 day | Improve observability at request boundaries; agree the planned durable denial-audit design before altering tables. | Correlated success/rejection/business/internal outcomes, duration measurements, and tests showing tokens, customer records, and reasons are absent from diagnostic logs. Cover malformed call envelopes. If denial auditing is implemented, prove denials persist without any refund write. |
| 7 | P1 · Week 2 · 0.5–1 day | Apply agreed README improvements and document reproducible gateway startup, demo, configuration, and local deployment behavior. | A fresh local run follows the documented commands and exercises allowed/denied paths. Document database location, process shutdown, and limitations. Verify Node 24 locally if available; record remote CI results only when an actual remote run is accessible. |
| 8 | P2 · End of Week 2, capacity permitting · 0.5 day | Propose a bounded AI-agent evaluation use case and API/data integration contract using the existing customer tools. | Reviewable proposal for a read-only customer-lookup agent first, with missing-customer, invalid-ID, tool-selection, and tool-error cases; define expected assertions, maximum tool calls, and future provider-failure cases. Mark it unimplemented and select no model/provider without agreement. |
| 9 | P2 · After the gateway baseline | Evaluate a deployment target and any real external data/API source with the developer. | Agreed operating environment, persistent-storage requirements, credential boundary, startup/health verification, and rollback approach before packaging or publishing. No invented endpoint, account, client, or deployment result. |

Items 1–7 are an approximately 6–8.5 day sequence, with review and troubleshooting potentially moving later items out of the window. Week 1 is September 11–17; Week 2 is September 18–24. No claim is made that work was performed on every date in those periods.

The existing SQLite integration supplies the immediate data-integration use case, and Task 2 supplies the next API boundary. A new CRM or ticketing vendor is not necessary to demonstrate that work. If a real external API is later selected, first agree authentication, field mapping, pagination where applicable, timeouts, rate-limit handling, and deterministic fixtures against its actual contract.

## Decisions to discuss before architectural changes

1. **HTTP and downstream trust:** keep the documented gateway → HTTP customer-service shape and preserve stdio. Agree how the downstream service is protected from bypass, how sessions are associated with authenticated callers, and which credentials belong on each connection. Do not pass the caller's bearer token through.
2. **Identity versus data isolation:** the planned signed demo tokens establish identity claims. Decide separately whether the fictional customer dataset is shared; do not advertise tenant isolation unless the data model and queries enforce it.
3. **Discovery versus execution:** retain the existing requirement that authenticated `tools/list` is unfiltered. Enforce authorization on execution. The `admin_` prefix rule does not itself authorize real refunds.
4. **Failure and audit semantics:** agree HTTP authentication failures versus JSON-RPC tool denials, request correlation, timeout/cancellation behavior, and denial-audit storage/retention. Refund retries need a separate business identity/idempotency design.
5. **Future agent boundary:** an agent would choose tool calls, unlike the current scripted client. Start with a proposed read-only flow and evaluation cases; any refund-capable agent needs an explicitly agreed execution/confirmation policy. No agent framework is selected here.

## README review and recommended improvements

The README already provides a useful status table, runnable commands, tool arguments, error contracts, stdout guidance, and current limits. Preserve those details. The main gap is that it leads with the learning/assessment framing without first explaining the integration problem or the new professional phase. Recommendations below are proposals; README.md was not edited in this review.

| Area | Recommended change |
| --- | --- |
| Project framing | Add the independent development phase and link to `docs/PROJECT_SCOPE.md`; retain the personal/FDE origin and use “customer-inspired integration case study.” |
| Problem and use case | Explain that the working system exposes fictional customer lookup and simulated refunds through a validated, discoverable tool interface. Do not imply an actual client or measured support outcome. |
| MCP usage | Name the one server, two tools, stdio transport, and initialization → discovery → tool-call flow. Explain that protocol interoperability is tested with the official SDK client. |
| AI/agent workflow | Add a visible paragraph stating that the current client is scripted and there are no LLM calls or autonomous tool decisions. Label the guardrail, limiter, fallback, and possible agent extension as future work. |
| Architecture | Put a compact current-flow diagram near the top. Link separately to the planned architecture so future gateways are not mistaken for working components. |
| Setup | Retain `npm ci`, `npm run check`, and `npm run demo`. Point out `.nvmrc`/Node 24, provide a concrete `SUPPORTBRIDGE_DB` example, and explain temporary demo storage versus persistent server storage. No API key is required for the current demo. |
| Demo/use cases | Show a short expected-output excerpt: customer found, simulated `amount_cents: 1250`, and `-32602` for invalid input. Explain where to inspect the restart/rollback/error tests and how to debug the child server in VS Code. |
| Validation and roadmap | Date local verification, distinguish configured CI from verified CI, and link to the prioritized development plan. Keep tasks marked planned until implementation and checks provide evidence. |

Suggested opening for review:

> SupportBridge is an independent software and AI development project exploring customer-support integrations through MCP. Its current implementation exposes fictional customer lookup and simulated refunds through a TypeScript MCP server, with strict input validation, SQLite persistence, and tests over actual stdio. It is a customer-inspired integration case study.
>
> Developed by Yu-Chen Su (Will), Independent Software & AI Consultant. The project began as a personal/FDE side project before September 11, 2026; a new active professional development phase began on that date. The current demo uses a scripted MCP client. HTTP security and AI-provider workflows remain planned.

## Evidence and change record for this review

On September 11, 2026, the source, package configuration, tests, demo, VS Code configuration, CI definition, README, handoff, and architecture/decision/walkthrough documents were inspected. `npm run check` passed all six tests and type checking; `npm run demo` completed on Node `25.5.0` with npm `11.8.0` using the installed dependencies. A fresh installation and remote CI were not tested.

This review adds scope and planning documentation. It does not change application behavior, select an external service, publish a deployment, or modify Git history. All future implementation follows explain → agree → implement → demonstrate → practice explaining back.
