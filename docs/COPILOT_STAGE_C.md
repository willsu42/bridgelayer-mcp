# Support Copilot Stage C — Failure demonstrations

Developed by **Yu-Chen Su**. Implemented November 13, 2026.

Stage C adds reproducible failure demonstrations to the English local workbench. The audience can see how the application handles unavailable generation capacity, stalled work, and insufficient token allowance, then explicitly return to a working Scripted draft. These scenarios are labeled **Failure simulation** throughout the UI.

## Run the demonstration

```sh
npm run demo:copilot
```

Open **http://127.0.0.1:3040/**. Select **Failure simulation** under Generation mode, choose a scenario, and click **Run simulation**. A Groq key is not required for this mode. The existing Live AI mode remains available when configured.

| Scenario | Injected condition | Actual behavior exercised | Expected evidence |
| --- | --- | --- | --- |
| Provider rate limit (429) | A local fixture raises `PROVIDER_RATE_LIMIT` after 500 ms. | Admission and unknown-usage settlement; no retry or fallback. | One simulated provider attempt; its estimated allowance is held. |
| Provider timeout | A local fixture stalls; the real stream read deadline expires after 1.5 seconds. | Pending work is aborted and unknown usage is settled. | One simulated provider attempt; cancellation observed; allowance held. |
| Insufficient token budget | A fresh ledger allows only one token. | Atomic reservation fails before the provider opens. | Zero simulated provider attempts and zero tokens held. |

All scenarios first perform a real lookup of a fictional customer through the existing authenticated MCP gateway. A lookup failure stops before simulation. No scenario calls Groq, submits the question to a cloud model, generates a reply, or changes the live token ledger.

The timeline reports the expected error code. The **Simulation evidence** panel reports observations from the local runner. `Scenario demonstrated` means the intended failure was observed and handled; it does not mean a draft succeeded. The underlying SSE response ends with `error`, never a draft `done` event. Unexpected failures retain the ordinary failure state.

After a completed scenario, click **Switch to Scripted recovery**, then **Generate draft**. The mode changes visibly and a new request uses the deterministic template. This is manual recovery, not automatic model fallback. Reset returns to Scripted mode, resets the scenario selection, and clears the previous evidence.

## Isolation and accounting

Each simulation creates its own in-memory SQLite ledger and disposes it after the request. Rate-limit and timeout scenarios use an 8,000-token ledger; budget rejection uses a one-token ledger. They share the Stage B generation runner, prompt allowance calculation, output cap, stream guardrail, and settlement rules. The fixture implements the generation interface locally and receives no live provider, API key, remote endpoint, or persistent ledger.

Model tokens are shown as **Not measured (simulation)**. A displayed retained allowance is the input-byte estimate plus the configured maximum output allowance; it is not measured usage, a real provider charge, or a real Groq quota. Budget rejection reports zero held tokens because admission failed. Every simulation starts fresh, so replaying it does not exhaust another simulation or the real live budget.

The short 1.5-second timeout is specific to this demonstration. Live generation retains its ten-second read timeout and the existing thirty-second overall request deadline. The existing four-request workbench cap applies across all modes. Stop, reset, disconnect, and shutdown propagate cancellation; the ledger closes after the generation runner's settlement cleanup. Cancellation may prevent the browser from receiving a final evidence event, in which case the UI reports an incomplete stopped run.

## Request contract

`POST /copilot/draft` accepts an additional mode and scenario:

```json
{
  "mode": "simulation",
  "scenario": "timeout",
  "customerId": "CUST-00002",
  "caseType": "billing",
  "issue": "Please help me understand a charge on my account.",
  "includeSampleEmail": true
}
```

The allowlisted scenarios are `rate-limit`, `timeout`, and `budget-exhausted`. Simulation requires a scenario. Scripted and Live requests must omit it. Clients cannot supply delays, budget amounts, keys, model IDs, or endpoints. The fixed viewer session, strict schema, same-origin requirement, body limits, and logging rules remain unchanged.

The new `simulation` SSE event includes a phase (`started` or `finished`), scenario, local provider attempt count, temporary budget usage/availability, and a cancellation observation. Simulation accounting events use `provider: "simulated"`; real Groq events retain `provider: "groq"`. The browser distinguishes the two rather than presenting fixture values as measured tokens.

## Three-minute English demo script

**0:00–0:35 — Establish the working flow.**

Select Sam Chen and Billing review in Scripted mode, then generate a draft.

> “BridgeLayer looks up the customer through an authenticated MCP gateway, prepares a draft, and applies supported email redaction before displaying the response. A human reviews and edits it before use. These customer records are fictional.”

**0:35–1:10 — Show a rate limit.**

Choose Failure simulation, select Provider rate limit, and run it.

> “This is a local simulation, not a real Groq incident. One provider attempt fails with a rate-limit error. BridgeLayer does not silently retry or replace the answer. Because final usage is unknown, the temporary ledger retains the allowance.”

**1:10–1:40 — Show a stalled provider.**

Select Provider timeout and run it. Point to the cancellation observation.

> “The provider fixture stays pending until the stream deadline cancels it. We shorten the deadline for presentation. The cancellation and settlement logic are the same paths used by the generation workflow.”

**1:40–2:10 — Show admission control.**

Select Insufficient token budget and run it. Point to zero attempts.

> “Here the budget check rejects the request before generation starts. The evidence shows zero provider attempts. This is how we demonstrate admission control without consuming external model quota.”

**2:10–2:40 — Demonstrate explicit recovery.**

Click Switch to Scripted recovery, then Generate draft.

> “Recovery is explicit. We select a known local template and start a new request. The UI does not present a template as a live AI answer.”

**2:40–3:00 — State the collaboration scope.**

> “This prototype demonstrates controlled customer lookup, output email protection, token admission, and visible failure handling. A customer pilot would add the agreed business-system integration, production identity and data isolation, and task-specific answer-quality evaluation.”

A separately configured Live AI run can show actual Groq drafting. It is optional for this failure demonstration and consumes provider quota. Do not present the local fixtures as proof of real Groq outage recovery, live fallback, comprehensive PII protection, or production readiness.

## Verification

On November 13, 2026, `npm run check` passed strict server/browser type checking, both builds, and **114 tests/subtests** on local Node **24.22.1** with installed dependencies. HTTP tests required permission for loopback listeners.

New integration tests exercise all three scenarios concurrently, matching error codes and evidence, cancellation on timeout, retention of unknown allowances, zero dispatch on budget rejection, isolation from a configured live provider and ledger, fresh replay, manual Scripted recovery, authentication/origin validation, invalid mode/scenario combinations, failed lookup, client disconnect, and server shutdown. Existing Stage A/B and Tasks 1–4 regression tests continue to pass.

Browser verification exercised all three scenarios against the local server, observed the expected evidence, generated a Scripted recovery draft, and checked Stop and Reset during a pending simulation. Desktop and narrow-screen layouts were inspected with no horizontal overflow reported by the document. Browser zoom produced effective layout widths of 1,152 and 312 CSS pixels.

The minimal real Groq key/stream check performed earlier on November 13 returned HTTP 200 and an `OK` reply, reporting 76 input and 18 output tokens. Stage C tests do not call Groq. Full customer-support answer-quality acceptance remains separate from that connectivity check. No deployment, remote CI run, new dependency installation, commit, or push is claimed.

## Implementation map

| File | Responsibility |
| --- | --- |
| `src/copilot/simulation.ts` | Local fault fixtures, isolated ledger lifecycle, observed simulation events. |
| `src/copilot/generation.ts` | Shared reservation/settlement path and explicit simulated usage labeling. |
| `src/copilot/contracts.ts` | Mode/scenario validation and event contracts. |
| `src/copilot/workflow.ts` | Authenticated lookup followed by the selected path. |
| `web/app.ts`, `web/index.html`, `web/styles.css` | Scenario controls, evidence, expected failure messaging, manual recovery. |
| `tests/copilot.test.ts` | Real HTTP/MCP integration, isolation, and lifecycle regression coverage. |
