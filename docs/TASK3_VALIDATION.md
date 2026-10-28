# Task 3 — Local validation and remaining CI gate

Validated October 28, 2026 (Asia/Taipei). **Implementation and local verification are complete; remote CI for these new changes is pending.** This is not a hosted deployment or live-provider verification.

## Executed checks

| Check | Result |
| --- | --- |
| Clean install on Node 24.22.1 / npm 11.19.1 | Passed: `npm ci --offline --cache /tmp/bridgelayer-npm-cache --no-audit --no-fund`, 98 packages, existing lockfile unchanged. Cached package data was downloaded during Task 2 closeout. |
| Node 24.22.1 | Type checking, build, and all 42 tests/subtests passed. |
| Node 22.23.4 | Type checking, build, and all 42 tests/subtests passed using the installed dependency tree. |
| Demonstrations on Node 24 | `demo:streaming`, `demo:http`, and `demo` completed successfully. |
| Measurement harness on Node 24 | Six scenarios, ten paired samples each; raw results linked below. |

Official arm64 Node archives were extracted under `/tmp` after SHA-256 verification against published checksums; system Node was not changed. HTTP checks required local loopback listener permission outside the execution sandbox. No source commit, push, or new remote workflow run is claimed. The existing CI definition automatically includes the new top-level test files on the next push/PR.

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

## Remaining work and limits

The remaining release evidence is an actual Node 22/24 remote CI run for the Task 3 change after it is committed/published through the normal workflow. The successful Task 2 run cannot establish this result. No remote CI success is claimed here.

The current provider is a deterministic, abort-aware mock. Live adapters must honor cancellation; the request can terminate a noncooperative adapter without proving that adapter released its internal resources. Email detection is a conservative ASCII substring policy with intentional false positives; unsupported PII formats can pass through. Existing MCP customer results are not redacted. Tests establish application-buffer bounds and controlled backpressure, not production capacity or general tenant isolation.

See the [walkthrough](03-streaming-guardrails-walkthrough.md) for exact behavior and the [implementation plan](TASK3_PLAN.md) for milestone status.
