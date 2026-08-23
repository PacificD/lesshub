# Rendering PoC runbook

## Runtime

Run every command below from the repository root (`lesshub`). Use Node 22 for both services, E2E, and benchmark commands. PNPM remains pinned to 7.29.1; dependency installation may use Node 18 as documented in `toolchain.md`.

Generate two independent secrets in one shell and load the same values in each service shell. Do not copy fixed secrets into scripts or documentation. Redis is defined by `compose.rendering-poc.yml`.

## Manual local services

Use the Docker context that owns your Redis daemon. The examples use `desktop-linux`; omit `--context desktop-linux` when that is already the current context.

Shell 1 — repository setup and Redis:

```bash
cd "$(git rev-parse --show-toplevel)"
export DOCKER_CONTEXT=desktop-linux
umask 077
export LESSHUB_SECRETS_FILE="$(mktemp "${TMPDIR:-/tmp}/lesshub-rendering-secrets.XXXXXX")"
trap 'rm -f -- "$LESSHUB_SECRETS_FILE"; exit 130' INT
trap 'rm -f -- "$LESSHUB_SECRETS_FILE"; exit 143' TERM
trap 'rm -f -- "$LESSHUB_SECRETS_FILE"' EXIT
export INTERNAL_SERVICE_TOKEN="$(openssl rand -hex 32)"
export SESSION_SIGNING_SECRET="$(openssl rand -hex 32)"
test "$INTERNAL_SERVICE_TOKEN" != "$SESSION_SIGNING_SECRET"
printf 'export INTERNAL_SERVICE_TOKEN=%q\nexport SESSION_SIGNING_SECRET=%q\n' \
  "$INTERNAL_SERVICE_TOKEN" "$SESSION_SIGNING_SECRET" >"$LESSHUB_SECRETS_FILE"
printf 'Copy this path into Shell 2 and Shell 3: export LESSHUB_SECRETS_FILE=%q\n' "$LESSHUB_SECRETS_FILE"
docker --context "$DOCKER_CONTEXT" compose -f compose.rendering-poc.yml up -d redis
pnpm --filter @lesshub/commerce-api build
pnpm --filter @lesshub/hono-react build
```

Shell 2 — commerce API (load the generated, uncommitted shell file):

```bash
cd "$(git rev-parse --show-toplevel)"
export DOCKER_CONTEXT=desktop-linux
# Paste the LESSHUB_SECRETS_FILE export printed by Shell 1 first.
. "$LESSHUB_SECRETS_FILE"
export COMMERCE_API_HOST=127.0.0.1
export COMMERCE_API_PORT=4001
export PAGE_SERVICE_URL=http://127.0.0.1:4000
export PAGE_SERVICE_ALLOWED_ORIGINS=http://127.0.0.1:4000
pnpm --filter @lesshub/commerce-api start
```

Shell 3 — page service (load the same independent secrets):

```bash
cd "$(git rev-parse --show-toplevel)"
export DOCKER_CONTEXT=desktop-linux
# Use the same LESSHUB_SECRETS_FILE path as Shell 2.
. "$LESSHUB_SECRETS_FILE"
export PAGE_SERVER_HOST=127.0.0.1
export PAGE_SERVER_PORT=4000
export COMMERCE_API_URL=http://127.0.0.1:4001
export REDIS_URL=redis://127.0.0.1:6379
export ENABLE_DEMO_ENDPOINTS=true
pnpm --filter @lesshub/hono-react start
```

The service shells intentionally run in the foreground. Stop them with Ctrl-C, then remove Redis with:

```bash
cd "$(git rev-parse --show-toplevel)"
export DOCKER_CONTEXT=desktop-linux
docker --context "$DOCKER_CONTEXT" compose -f compose.rendering-poc.yml down --volumes
rm -f -- "$LESSHUB_SECRETS_FILE"
```

## Verification

For repeatable isolated runs, prefer the wrappers below. They allocate ports, generate child-process secrets, retain timestamped artifacts below `test-results/<UTC>-<id>/`, and tear down Redis automatically:

```bash
cd "$(git rev-parse --show-toplevel)"
export DOCKER_CONTEXT=desktop-linux
pnpm build
pnpm build:verify
pnpm test
pnpm test:e2e
pnpm benchmark:quick
```

`pnpm test` creates `test-results/<UTC>-<id>/` containing `test.log`, merged `junit.xml`, `coverage-summary.json`, and `test-report.md`. `pnpm test:e2e` creates its own directory in the same pattern with `junit.xml`, `results.json`, `e2e-report.md`, `test.log`, and failure traces/screenshots. The E2E failure gate uses the same run directory and performs real Redis stop/start and commerce outage/recovery checks; a failed gate exits non-zero. Both isolated E2E runners handle SIGINT/SIGTERM idempotently, restore Redis, stop child services, remove Compose volumes, and exit 130/143.

Set `DOCKER_CONTEXT=desktop-linux` (or another named context) only when the current Docker context is not desired. The E2E and benchmark wrappers pass that context to Compose.

`benchmark:quick` runs the correctness protocol, real Redis and commerce failure/recovery, warm/cold server measurements, and browser conditions with system Chrome. `benchmark:full` uses five rotated rounds, 50 connections, and three 20-second segments per warm endpoint; it is intentionally not a normal CI gate. `pnpm benchmark:full -- --validate-only` validates the full matrix and schemas without creating a result directory or running the long profile.

To create a demo authenticated session against a page server with demo endpoints enabled:

```bash
cd "$(git rev-parse --show-toplevel)"
. "$LESSHUB_SECRETS_FILE"
curl -i -X POST http://127.0.0.1:4000/internal/demo/session \
  -H "Authorization: Bearer $INTERNAL_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"userId":"user-ada"}'
```

Mutations are internal commerce endpoints and emit cache invalidation webhooks; use the same commerce token:

```bash
cd "$(git rev-parse --show-toplevel)"
. "$LESSHUB_SECRETS_FILE"
curl -X PATCH http://127.0.0.1:4001/internal/products/product-01/price \
  -H "Authorization: Bearer $INTERNAL_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"countryCode":"GB","priceMinor":999}'
```

Every benchmark run writes a unique directory below repository-root `benchmark/results/`; the checked local reference is in `benchmark/baseline/`. Read `environment.json` before interpreting results. CSR shell throughput is labelled non-comparable; complete user experience is represented by browser metrics. Cold scenarios report latency only, never sustained RPS. Do not compare absolute values across machines.

The runner owns isolated dynamic ports, a Compose project, services, and results. Dynamic ports are recorded only through the runner environment and are intentionally not persisted as stable endpoints. It tears them down in `finally` and on SIGINT/SIGTERM, including after partial failure, while preserving partial logs. It tests Redis stop/start and commerce stop/start, then restores seed and prewarms caches. Secrets exist only in child-process environment variables and are excluded from reports/logs.

## Residual operational limitation

Dynamic ports are selected by pre-binding and closing a socket before child processes bind. Another process can theoretically win that small race. A production harness should pass inherited sockets or use an external allocator.
