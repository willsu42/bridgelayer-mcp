# Task 3 — Local and remote validation

Local validation dated October 28, 2026 (Asia/Taipei); remote CI verified October 29. **Task 3 acceptance is complete within the email-only mock-provider scope.** See [TASK3_CLOSEOUT.md](TASK3_CLOSEOUT.md) for verified commits and job links. This is not a hosted deployment or live-provider verification.

## Executed checks

| Check | Result |
| --- | --- |
| Clean install on Node 24.22.1 / npm 11.19.1 | Passed: `npm ci --offline --cache /tmp/bridgelayer-npm-cache --no-audit --no-fund`, 98 packages, existing lockfile unchanged. Cached package data was downloaded during Task 2 closeout. |
| Node 24.22.1 | Type checking, build, and all 42 tests/subtests passed. |
| Node 22.23.4 | Type checking, build, and all 42 tests/subtests passed using the installed dependency tree. |
| Demonstrations on Node 24 | `demo:streaming`, `demo:http`, and `demo` completed successfully. |
| Measurement harness on Node 24 | Six scenarios, ten paired samples each; raw results linked below. |

Official arm64 Node archives were extracted under `/tmp` after SHA-256 verification against published checksums; system Node was not changed. HTTP checks required local loopback listener permission outside the execution sandbox. The October 28 local verification session did not create a source commit, push, or trigger a remote run. Subsequent existing remote runs for `6eb5604` and `b0ef476` were inspected October 29; both Node 22/24 jobs passed `npm ci` and `npm run check`, including the new test files. See the [closeout evidence](TASK3_CLOSEOUT.md).

The suite preserves the original 23 tests/subtests and adds 19 streaming cases. Coverage includes hand-authored expected output, an independent whole-input policy over known fixtures, every two-part wire split, every text split in supported fixtures, seeded multi-splits, Unicode/JSON/SSE framing, final flush, malformed/truncated input, exact/overflow resource bounds, non-progressing empty chunks, cooperative cancellation, slow writable behavior, HTTP authorization, concurrency/slot recovery, audit failure, and log privacy.

## Benchmark observations

Machine: Apple M4 Pro, darwin arm64; runtime v24.22.1. Each provider delta is serialized into SSE and split into chunks up to 256 bytes, with a requested 1 ms delay before each chunk; the terminal event is immediate. Ten sequential reference/guarded pairs per scenario. The slow consumer delays 2 ms per emitted fragment.

Times below are milliseconds from pipeline invocation, excluding HTTP/authentication. They include source pacing and scheduling jitter. Buffer columns are logical UTF-8 byte peaks, not RSS. The long-token scenario demonstrates buffering/suppression cost rather than a performance failure.

| Scenario | First safe output median / p95 | Guarded total median / p95 | Aligned safe-prefix added delay median / p95 | Peak token / event bytes |
| --- | --- | --- | --- | --- |
| plain | 1.210 / 1.477 | 3.665 / 4.072 | 0.023 / 0.079 | 9 / 50 |
| split-email | 1.230 / 1.279 | 4.905 / 5.053 | 0.024 / 0.072 | 26 / 47 |
| email-heavy | 1.193 / 1.265 | 2.427 / 2.531 | N/A | 16 / 65 |
| long-token | 28.459 / 30.660 | 29.878 / 32.377 | N/A | 4096 / 4128 |
| malformed | 1.371 / 1.467 | 2.971 / 3.154 | N/A | 16 / 48 |
| slow-consumer | 1.350 / 1.527 | 24.688 / 26.676 | 2.308 / 3.477 | 9 / 50 |

The malformed scenario emits its earlier safe text and then fails; its pending email never appears. Aligned delay is measured only for the known-safe `Hello ` or `Contact ` prefix, not for redacted/replaced spans. Negative paired differences can occur from timer jitter. Slow-consumer totals include different fragment counts between reference and guarded paths, so they are not a pure CPU-overhead comparison. No numeric latency or throughput SLA is inferred from these small fixtures.

The maximum observed pending token was 4096 bytes, matching the configured cap. The pipeline-only benchmark reports zero HTTP frame bytes because it does not serialize HTTP output. The HTTP demo separately recorded bounded frames and server request durations. Exact 64 KiB parser limits and 1 MiB total-input boundaries are exercised by tests, not estimated from these small benchmark fixtures.

Raw data: [task3-node24-2026-10-28.json](benchmarks/task3-node24-2026-10-28.json). Reproduce with `npm run bench:streaming`; values will vary by machine and load. The unsafe reference is confined to the measurement script.

## Acceptance status and limits

The remote CI gate is closed. [Run 40891597571](https://github.com/willsu42/bridgelayer-mcp/actions/runs/40891597571) passed on Node 22 and 24 for `b0ef476`; the implementation run for `6eb5604` also passed. Full commit IDs, job links, and evidence dates are in [TASK3_CLOSEOUT.md](TASK3_CLOSEOUT.md). The October 28 local results above were not rerun during closeout.

The current provider is a deterministic, abort-aware mock. Live adapters must honor cancellation; the request can terminate a noncooperative adapter without proving that adapter released its internal resources. Email detection is a conservative ASCII substring policy with intentional false positives; unsupported PII formats can pass through. Existing MCP customer results are not redacted. Tests establish application-buffer bounds and controlled backpressure, not production capacity or general tenant isolation.

See the [walkthrough](03-streaming-guardrails-walkthrough.md) for exact behavior and the [implementation plan](TASK3_PLAN.md) for milestone status.
