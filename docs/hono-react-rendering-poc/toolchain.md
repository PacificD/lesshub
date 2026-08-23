# Rendering PoC toolchain

## Version split

- Workspace package manager: PNPM 7.29.1 (unchanged major/version pin).
- Dependency installation: Node 18 + PNPM 7.29.1.
- `commerce-api`, `hono-react`, Playwright E2E, and future benchmark runtime: Node 22 exactly (major 22).
- Legacy workspaces retain the root `node >=18` compatibility range.

PNPM 7.29.1 can fail during an online registry fetch under Node 22 (`ERR_INVALID_THIS`). Do not globally activate another Corepack version and do not let PNPM 8 rewrite `pnpm-lock.yaml`.

Cold install:

```sh
# Select Node 18 using the developer's normal version manager, then:
corepack pnpm --version  # must print 7.29.1
corepack pnpm install --frozen-lockfile
```

Runtime validation:

```sh
# Select Node 22, then:
corepack pnpm runtime:check # must report Node 22.x
corepack pnpm toolchain:check
corepack pnpm --filter @lesshub/commerce-contracts build
corepack pnpm --filter @lesshub/commerce-api build
corepack pnpm --filter @lesshub/hono-react build
```

The root `preinstall` rejects a package manager other than PNPM 7.29.1. The root Node engine intentionally remains `>=18` so the approved Node 18 install step can run; `scripts/check-node22.cjs` is the separate runtime gate used by both new services, Playwright E2E, and the benchmark command entrypoints. Root Turbo scripts prepend the repository-local `scripts/bin/pnpm` wrapper, so Turbo child processes also execute `corepack pnpm` instead of an ambient PNPM 8 binary. `corepack enable` is intentionally not part of the workflow because it changes global shims.

## Vite server build decision

M0 validates a direct Vite SSR library-mode build of the Hono Node entrypoint. This is the smallest working adapter for the current non-streaming Node server and avoids adding a pass-through dependency. The official Hono Vite build plugin remains an optional later migration if deployment or dev-server integration requires its additional behavior; this PoC does not claim to use that plugin.
