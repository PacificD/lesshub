# Local rendering benchmark baseline

This baseline is the schema-valid final M6 quick run `2026-08-22T204934-329Z-ea865659`, measured on the machine and software recorded in `environment.json`. It was produced from a dirty working tree on 2026-08-22, so it is a reproducibility reference for this PoC rather than a release claim.

The run contains the exact 22 server identities and 12 browser conditions defined by the shared matrix planner. Browser measurements use ten deterministic left-rotated sample sequences with extension-filtered JS/CSS transfer bytes. The server summary reports the two-request CSR combined-transaction cost, and the correctness section records the complete price and translation invalidation partitions plus all-key, Redis-outage, and commerce-outage checks.

Absolute latency and throughput values must not be compared across machines. Compare only controlled runs with compatible environment metadata and protocol parameters. Raw service and browser logs are intentionally omitted from the committed baseline; regenerate them with `pnpm benchmark:quick`.
