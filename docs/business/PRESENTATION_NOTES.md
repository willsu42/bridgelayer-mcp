# BridgeLayer Business Presentation

Developer: Yu-Chen Su  
November 2026

Audience: potential customers, investors, and commercial partners.

## Slide 1 BridgeLayer

### Speaker notes

BridgeLayer is a backend prototype developed by Yu-Chen Su. This discussion concerns a proposed customer pilot, commercial partnerships, and the evidence needed for an investment case. Four engineering milestones are complete within a local demonstration scope. The current prototype uses fictional customer data and deterministic model providers. Commercial delivery requires additional integration and operational work.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/PROJECT_CLOSEOUT.md

## Slide 2 Customer-support integration controls

### Speaker notes

The proposed customer problem is the engineering work required to put controls around a support workflow that uses AI. A team needs explicit behavior at the boundary between its application, business tools, and model providers. These questions define the problem to validate with customers. They are not survey findings or quantified market demand. The prototype demonstrates selected answers through scripted requests and deliberately injected failures.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/PROJECT_CLOSEOUT.md

## Slide 3 The BridgeLayer prototype

### Speaker notes

BridgeLayer currently demonstrates two independent workflows. A scripted MCP client accesses customer lookup and simulated refund tools through authentication and execution policy. A separate streaming client receives predefined text through an email guardrail and optionally a tenant token ledger and fallback router. MCP means Model Context Protocol. The future product could combine these components into a support application, but a live model does not currently invoke the customer tools.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/PROJECT_CLOSEOUT.md
- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/ARCHITECTURE.md

## Slide 4 Initial customers and use case

### Speaker notes

The proposed first customer is a software team building AI support features, either for a support product or for internal operations. The buyer hypothesis is an engineering or product leader who owns delivery. A useful first partner has a workflow owner and sandbox customer-system access. The proposed first use case is customer lookup and a response draft reviewed by a human support agent. It requires new orchestration and live integration. Customer demand and willingness to pay still need validation.

## Slide 5 Demonstration examples

### Speaker notes

Use the scripted streaming and resilience demos for this slide. The email example contains fictional data. The redactor holds an unresolved whitespace token and replaces the whole token if it matches a supported ASCII email pattern, including when fragments arrive separately. It can remove punctuation and can over-redact malformed addresses. Fallback allows at most one separately admitted backup after a primary 429 or first-usable-text timeout, only before output. It never splices a backup answer into an already emitted response.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/03-streaming-guardrails-walkthrough.md
- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/04-token-budgets-and-fallback-walkthrough.md

## Slide 6 Engineering validation

### Speaker notes

The November 1 local validation recorded strict type checking, build, and 66 tests/subtests on Node 22.23.4 and 24.22.1. All four demos passed locally on Node 24. GitHub Actions ran npm ci and npm run check on Node 22 and 24 for implementation revision dc381faccc90b8baea5da1cb6a45b6eba7a7c2c7. The November 3 closeout verified that run. CI did not run the demos. These are prototype engineering results, not production throughput, uptime, real model quality, customer adoption, or revenue evidence.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/TASK4_CLOSEOUT.md
- https://github.com/willsu42/bridgelayer-mcp/actions/runs/41320833908

## Slide 7 Current scope and productization

### Speaker notes

The controls are implemented, but several integrations are deliberately simulated. No live model, CRM, payment processor, hosted deployment, or support interface is included. The viewer/admin tool policy is a demonstration policy, and viewers may create simulated refunds. Real action authorization requires a new design. Customer records are shared fictional records. Tenant budget counters do not imply tenant isolation for customer data. The email redactor applies only to streaming routes and does not sanitize MCP customer responses.

### Sources

- https://github.com/willsu42/bridgelayer-mcp/blob/main/docs/PROJECT_CLOSEOUT.md

## Slide 8 Proposed customer pilot

### Speaker notes

The pilot proposal covers one lookup-and-draft workflow in an approved environment. First, the parties agree on the workflow, data boundary, baseline, and acceptance criteria. Next comes a sandbox customer integration and a live provider, including suitable identity and data isolation. Evaluation includes failure injection and human review of drafts. The last stage is an expansion, revision, or stop decision. Scope, fees, and schedule must be agreed before delivery. These are proposed stages, not promised dates or signed commitments.

## Slide 9 Pilot acceptance measures

### Speaker notes

These measures define how to evaluate the pilot. The parties must agree numeric thresholds before implementation. Policy checks should block every agreed denial case and exercise tenant data isolation. Response protection requires a representative corpus and both miss and false-positive rates. Usage accounting requires trustworthy live provider reports and reconciliation. Reliability tests cover bounded fallback and cancellation. Business value requires a baseline for draft acceptance, review effort, integration time, and cost per completed workflow. The prototype does not yet provide these customer outcomes.

## Slide 10 Commercial model to validate

### Speaker notes

A scoped paid pilot is the proposed first offer. Successful evaluation could support a subscription or license and separately scoped implementation and support. No price, contract, customer revenue, or margin is established. Potential channels include support-platform vendors and implementation consultancies. Discovery and repeat pilots should test who buys, willingness to pay, how much integration work repeats, and whether ongoing support costs permit a sustainable business. No partner relationship or distribution agreement is claimed.

## Slide 11 Productization and investment milestones

### Speaker notes

The investment thesis is that multiple support teams may pay for reusable integration controls. The evidence needed now is a validated customer problem and a live workflow. Repeated delivery should show reusable implementation and customer outcomes. Operational readiness then needs monitoring, recovery, load behavior, credential management, and a defined deployment model. Potential funding would support these steps. A funding amount, valuation, hiring plan, and financial forecast remain open until there is a delivery budget and commercial evidence. This deck claims no market size, traction, or revenue.

## Slide 12 A scoped collaboration

### Speaker notes

The proposed next action is a discovery meeting to choose a single workflow and identify the partner’s engineering owner. A customer or integration partner would contribute sandbox access, approved sample data, and staff feedback. Yu-Chen Su would scope integration and evaluation work. The output should be a pilot proposal with responsibilities, acceptance criteria, fees, and a schedule agreed by both parties. Investors and strategic partners can review the technical demo and discuss the evidence needed for the next milestone. No funding amount or commercial commitment is requested in this deck.
