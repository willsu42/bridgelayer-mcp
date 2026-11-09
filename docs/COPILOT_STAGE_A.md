# Support Copilot Stage A

> Historical Stage A record (November 8). [Stage B](COPILOT_STAGE_B.md) now adds optional Groq generation and budget accounting; the current launcher and workbench support both modes.

Implemented November 8, 2026. Developer: **Yu-Chen Su**.

Stage A adds a local English workbench that connects customer lookup to a scripted response draft. It uses the existing MCP gateway and streaming email guardrail. It does not connect a live model, consume model tokens, send messages, or issue refunds.

## Run the demo

Use Node 24 and install the pinned dependencies with `npm ci` if needed. Then run:

```sh
npm run demo:copilot
```

Open **http://127.0.0.1:3040/**. The command compiles server and browser TypeScript, creates fresh in-memory customer/audit databases and random credentials, and starts three loopback listeners in one process. Only the workbench uses a fixed port. The customer service and gateway receive ephemeral ports.

No API key or environment secret is needed. To choose another workbench port:

```sh
BRIDGELAYER_COPILOT_PORT=3045 npm run demo:copilot
```

Press Ctrl+C to stop. Restarting creates fresh demo state. The existing `start:http` and four original demo commands retain their behavior. The workbench needs the repository's `web/` assets as well as compiled `dist/` files.

## Demonstration script

1. Select **Sam Chen**, then **Billing review**.
2. Leave **Include a sample email** checked and click **Generate draft**.
3. Observe the actual MCP lookup, the verified Starter plan, and streamed template text. The sample address becomes `[REDACTED_EMAIL]`.
4. Review the redaction count and output byte count. These describe guarded generated text before manual edits. Elapsed time measures the browser request, including session setup and lookup.
5. Edit the completed draft and click **Copy draft**. When clipboard permission is unavailable, the interface selects the text for manual copying.
6. Generate again and click **Stop generation**. The partial draft is marked incomplete. Stopping before the first text can leave no draft.
7. Use **Reset demo** while a request is active. It cancels the request, clears the draft and events, and restores initial selections. Stale responses cannot append to the new view.
8. Select **Jordan Taylor**, choose **Access assistance**, and uncheck the sample-email option. The next draft uses Jordan's Team plan and independent guardrail state.

The question appears as a quote within a case-specific template. The program does not interpret arbitrary questions or verify billing, access, or entitlement details. Customer records contain only an ID, name, email, and plan. The cases are illustrative prompts, not stored tickets.

## Request flow

```mermaid
sequenceDiagram
    participant Browser
    participant Copilot as Local workbench server
    participant Gateway as Existing JWT gateway
    participant MCP as Customer MCP service
    Browser->>Copilot: Start fixed viewer demo session
    Copilot-->>Browser: HttpOnly session cookie
    Browser->>Copilot: POST /copilot/draft
    Copilot->>Gateway: MCP initialization and get_customer_record
    Gateway->>MCP: Forward with separate service credential
    MCP-->>Gateway: Customer record
    Gateway-->>Copilot: Customer result
    Note over Copilot: Select ID, name, and plan; exclude customer email
    Note over Copilot: Scripted SSE bytes pass through existing guardStream
    Copilot-->>Browser: Status, customer, guarded deltas, metrics, done
```

The workflow always queries the selected customer through the official MCP client and existing gateway. Selection metadata in the browser is not evidence of successful lookup. Lookup failure ends the request without generating a draft.

## API and limits

| Endpoint | Behavior |
| --- | --- |
| `GET /` | English workbench with local static assets. |
| `POST /api/session` | Accepts exactly `{}` and sets a 15-minute HttpOnly, SameSite=Strict demo JWT cookie. Fixed subject and tenant: `copilot-demo`. Fixed role: `viewer`. |
| `GET /api/catalog` | Requires the demo cookie. Returns three fictional profile selectors and three case templates. |
| `POST /copilot/draft` | Requires the demo cookie, exact same-origin header, JSON input, and an SSE Accept header. Executes lookup and streams the guarded draft. |

Draft input:

```json
{
  "customerId": "CUST-00001",
  "caseType": "account",
  "issue": "Please confirm my current customer plan.",
  "includeSampleEmail": true
}
```

`caseType` is `account`, `billing`, or `access`. The trimmed issue must contain 10–1,200 UTF-16 code units. Extra fields, invalid customer-ID syntax, and lone surrogates are rejected. The body is limited to 8 KiB, body reads to three seconds, and the entire request to thirty seconds. At most four draft requests can be active per workbench process. The existing guardrail retains its byte, token, and stream limits.

SSE events are `status`, `customer`, `delta`, `metrics`, `done`, and `error`. Pre-stream validation failures use an HTTP error with sanitized JSON. Failures after status output use SSE `error` and never a success marker. Disconnect cancels lookup/streaming. A blocked socket stops source consumption. Shutdown waits for active handlers before closing the gateway and databases.

The browser treats EOF without `done` as incomplete. It renders text through text nodes and textarea values. Input resembling HTML remains text. Raw model reasoning is not available or displayed.

## Authentication and data scope

This is a loopback-only demonstration, not a production login. Any permitted local browser can establish the fixed viewer session. The local HTTP cookie intentionally has no Secure flag. Exact Host/Origin checks, a same-origin requirement for POSTs, static asset allowlisting, and a restrictive Content Security Policy bound browser access. Signing and service secrets are generated at startup and never returned to the browser.

The JWT cookie remains a credential even though JavaScript cannot read it. The workbench forwards the verified identity only to its configured loopback gateway. It never connects the browser directly to the customer service or accepts a caller-selected role or tenant.

Customer email is excluded from generation context and the customer event. The optional sample address is `support@example.com`. Emails entered in the issue pass through the output guardrail when the template quotes the issue. Input fields remain visible to the person who typed them. The guardrail detects supported ASCII email patterns, not all personal data. Whole-token redaction can remove punctuation or over-redact malformed addresses.

Customer records remain shared fictional data. Stage A does not add tenant data isolation. Customer and denial-audit databases are in memory. Logs record IDs, fixed event names, outcomes, and durations without records, questions, or cookies. The workbench exposes only lookup and drafting, even though the original separate MCP demo supports simulated refunds.

## Implementation map

| File | Responsibility |
| --- | --- |
| [start-copilot.ts](../scripts/start-copilot.ts) | Local stack, credentials, in-memory stores, and shutdown. |
| [server.ts](../src/copilot/server.ts) | Assets, session, validation, admission, SSE writes, and cancellation. |
| [customer-client.ts](../src/copilot/customer-client.ts) | Official MCP client, gateway authentication, result validation, and field selection. |
| [workflow.ts](../src/copilot/workflow.ts) | Lookup, activity events, scripted generation, and guardrail integration. |
| [scripted.ts](../src/copilot/scripted.ts) | Case templates emitted in small, cancellable fragments. |
| [contracts.ts](../src/copilot/contracts.ts) | Strict schemas and selection metadata. |
| [app.ts](../web/app.ts) | Browser SSE consumption, editing, copy, stop, reset, and stale-request protection. |
| [copilot.test.ts](../tests/copilot.test.ts) | Real HTTP/MCP integration and lifecycle tests. |

## Validation

On November 8, 2026, `npm run check` passed strict server/browser type checking, both builds, and **74 tests/subtests** on local Node **24.22.1** using installed dependencies. This includes the previous 66 tests/subtests and eight Copilot tests covering actual gateway lookup, auth/input boundaries, redaction and metrics, lookup/stream failures, concurrent state, four-slot admission, cancellation, and shutdown. HTTP checks required loopback-listener access outside the restricted execution sandbox.

Browser verification covered customer/case selection, streamed completion, editing and clipboard copying, stopping, resetting during generation, incomplete-stream detection and retry, literal HTML input, and a 390-pixel mobile viewport without horizontal overflow. Desktop and mobile layouts were inspected. This validation does not claim a fresh installation, new remote CI results, Node 22 execution for Stage A, or deployment.

## Next stages

Stage B adds a live provider and suitable generation input, estimation, actual usage accounting, and cancellation validation. Stage C adds controlled failure demonstrations and any separately agreed sharing/deployment work. Stage A does **not** call the Task 4 budget/fallback router or fabricate token usage. That router remains independently available in `demo:resilience`.

The dated Tasks 1–4 closeouts and business presentation describe their historical scopes. Stage A is an additional delivery, not a rewrite of those acceptance records.
