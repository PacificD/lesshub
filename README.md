# Lesshub

https://github.com/pacificd/lesshub

## Hono + React rendering benchmark PoC

This repository contains a reproducible comparison of `html-cache`, `data-cache`, `live-ssr`, and `csr` rendering strategies.

Full setup and manual service instructions:

- [`docs/hono-react-rendering-poc/runbook.md`](docs/hono-react-rendering-poc/runbook.md)
- [`docs/hono-react-rendering-poc/spec.md`](docs/hono-react-rendering-poc/spec.md)
- [`docs/hono-react-rendering-poc/plan.md`](docs/hono-react-rendering-poc/plan.md)

### Quick start

Requirements: Node 22 for runtime, PNPM 7.29.1, Docker with Redis support, and installed Chrome for Playwright. For a fresh dependency install, use the Node 18 + PNPM 7 procedure in `docs/hono-react-rendering-poc/toolchain.md`; run the services and benchmarks with Node 22.

```bash
cd /path/to/lesshub

# If dependencies are not installed, switch to Node 18 for this step as documented.
corepack pnpm install --frozen-lockfile
# Then switch back to Node 22 for the commands below.

# Build and verify static fragments/assets.
corepack pnpm build
corepack pnpm build:verify

# Run unit/integration tests and the real Redis/browser E2E gate.
corepack pnpm test
DOCKER_CONTEXT=desktop-linux corepack pnpm test:e2e
```

If `desktop-linux` is already the active Docker context, omit `DOCKER_CONTEXT=desktop-linux`. The E2E wrapper generates isolated secrets, ports, Redis containers, and timestamped artifacts automatically.

### Run the performance benchmark

```bash
# Quick profile: warm/cold server, browser, mutation, and failure recovery.
DOCKER_CONTEXT=desktop-linux corepack pnpm benchmark:quick

# Validate the full matrix without running the long load test.
corepack pnpm benchmark:full -- --validate-only

# Full profile: five rounds, 50 connections, 3 × 20-second warm segments.
DOCKER_CONTEXT=desktop-linux corepack pnpm benchmark:full
```

The benchmark prints `BENCHMARK_RESULTS_DIR`. Open its `benchmark-report.md`, or inspect `server-summary.json`, `browser-summary.json`, `environment.json`, and `raw/`. Results are machine-specific; do not compare absolute latency/RPS across machines.

### Generate the visual report

After running `pnpm test` and `pnpm benchmark:quick`:

```bash
corepack pnpm report:dashboard
```

The command finds the newest complete benchmark and test report and writes a standalone, dependency-free HTML dashboard to `test-results/dashboard-<timestamp>-<id>/benchmark-dashboard.html`. Open that file directly in Chrome. It compares server throughput/latency, browser-visible timing and asset cache evidence, correctness assertions, and workspace test coverage.

A checked-in reference baseline is available at [`benchmark/baseline/benchmark-report.md`](benchmark/baseline/benchmark-report.md).
