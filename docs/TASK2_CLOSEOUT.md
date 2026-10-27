# Task 2 closeout — October 27, 2026

Task 2 is complete within the local HTTP/security gateway scope in [PROJECT_SCOPE.md](PROJECT_SCOPE.md). This closeout adds reproducibility and remote CI evidence to the September implementation; it does not add application behavior or start Task 3.

## Local verification

Verified on October 27, 2026 (Asia/Taipei), against application commit `a744bfdac92612806321492c27e5f028ff830169`, on macOS arm64 with Node **24.22.1** and npm **11.19.1**.

| Check | Result |
| --- | --- |
| Clean dependency installation | Passed; 98 packages installed from the existing lockfile without changes. |
| `npm run check` | Passed strict type checking, build, and all 23 tests/subtests; no failures or skips. |
| `npm run demo:http` | Passed discovery, lookup, 1250-cent simulated refund, viewer denial, admin success, and missing-token HTTP 401. |
| `npm run demo` | Passed original stdio discovery, lookup, simulated refund, and invalid-amount rejection. |

The initial network installation used Node 25.5.0 / npm 11.8.0 to populate a temporary npm cache. A second clean `npm ci --offline --cache /tmp/bridgelayer-npm-cache --no-audit --no-fund` used Node 24.22.1 / npm 11.19.1 and that cache. This verifies a clean dependency tree on the recommended major version; it is not a claim of an empty-cache network installation under Node 24 or a dependency vulnerability audit.

The installed Homebrew `node@24` path reported Node 25.5.0, so the verification used the [official Node 24.22.1 archive](https://nodejs.org/dist/v24.22.1/) extracted under `/tmp`, after matching its SHA-256 against the published checksums. The system Node installation was not changed. Check `node --version` before reproducing:

```sh
# Activate Node 24 using your version manager first.
node --version
npm --version
npm ci
npm run check
npm run demo:http
npm run demo
```

The first sandboxed test run could not bind `127.0.0.1` (`listen EPERM`); the complete suite and demos passed when local listener access was permitted. Both demos use temporary databases and clean up after completion.

## Remote CI evidence

The existing [Check workflow run 35180116876](https://github.com/willsu42/bridgelayer-mcp/actions/runs/35180116876) ran on September 17, 2026 (Asia/Taipei), against the same full commit above. Its results were inspected on October 27; no new CI run or push was performed for this closeout.

| Job | Result |
| --- | --- |
| [Node 22](https://github.com/willsu42/bridgelayer-mcp/actions/runs/35180116876/job/105070235203) | Success, including `npm ci` and `npm run check`. |
| [Node 24](https://github.com/willsu42/bridgelayer-mcp/actions/runs/35180116876/job/105070235010) | Success, including `npm ci` and `npm run check`. |

The remote workflow runs tests, not the demo scripts. Demo evidence above is local. These remote results apply to the application commit, not a subsequent documentation commit.

## Acceptance and remaining boundaries

The existing tests cover authenticated discovery/calls, exact viewer admin denial with matching request IDs, zero forwarding after denial, separate downstream credentials, protected service access, durable denial records, sanitized failures, timeout/disconnect/shutdown cancellation, log privacy, and original refund/audit persistence after a full stdio process restart. See [http.test.ts](../tests/http.test.ts), [mcp.test.ts](../tests/mcp.test.ts), and the [HTTP walkthrough](02-http-gateway-walkthrough.md).

No Task 2 acceptance items remain open. Automated audit retention, general SQLite contention/capacity measurement, schema migrations, and tenant data isolation remain separate future work. The service uses shared fictional data and simulated refunds; viewers can refund, and timed-out writes must not be automatically retried. Production OAuth, hosting, external APIs, and real payment authorization are outside this delivery. Tasks 3–4, React, and LLM/agent execution remain unimplemented.

Next: review the Task 2 request path and agree Task 3's streaming PII design and acceptance cases before implementation.
