# Hono + React 混合渲染与缓存 Benchmark 实施计划

## 1. 计划状态

- 状态：M0–M8 已完成；最终独立审查通过
- 需求规格：[`spec.md`](./spec.md)
- 实施原则：按里程碑串行推进；一个活动 worktree 同时只允许一个 writer
- 当前交付边界：已获授权，按 M0–M8 串行实施

## 2. 交付物

计划完成后仓库应包含：

```text
apps/
  hono-react/
    src/
    scripts/
    benchmark/
    tests/
    package.json
    vite.config.ts
    tsconfig.json
  commerce-api/
    src/
    tests/
    package.json
    vite.config.ts
    tsconfig.json
packages/
  commerce-contracts/
    src/
    package.json
    tsconfig.json
docs/
  hono-react-rendering-poc/
    spec.md
    plan.md
compose.rendering-poc.yml
```

所有新 package 使用唯一名称，建议：

- `@lesshub/hono-react`
- `@lesshub/commerce-api`
- `@lesshub/commerce-contracts`

## 3. 实施约束

1. Node.js 固定为 22 LTS，React 固定为 19。
2. 不升级仓库 PNPM 7/Turborepo 1 主版本。
3. 输出目录使用 `dist/**`，以匹配现有 Turbo build outputs。
4. 页面 build 不访问运行中的业务 API。
5. 首期只实现非流式 `renderToString`。
6. 不复用 Next.js hydration 实现；当前仓库没有独立 Hono + React SSR 基线。
7. 页面服务与业务服务只通过 HTTP/runtime contract 交互。
8. 所有 cache key 通过单一 typed builder 生成。
9. 个性化数据不得进入共享 fragment/page cache。
10. 性能结果不作为常规 build/test 的硬编码阈值。

## 4. 建议模块边界

### 4.1 `packages/commerce-contracts`

公开少量稳定接口：

```text
country/language/currency definitions
catalog and user schemas
API error schema
cache invalidation event schema
```

该 package 不包含 Hono app、Redis client、React component 或 seed store。

### 4.2 `apps/commerce-api`

建议模块：

```text
src/
  app.ts                  # Hono routes，不直接 listen
  server.ts               # Node adapter 启动
  config.ts
  domain/
    catalog-store.ts      # 固定 seed + mutation
    seed.ts
  routes/
    catalog.ts
    users.ts
    internal.ts
  services/
    invalidation-client.ts
  observability/
    logger.ts
```

`app.ts` 与 `server.ts` 分开，便于 `app.request()` integration test。

### 4.3 `apps/hono-react`

建议模块：

```text
src/
  app.ts
  server.ts
  config.ts
  locale/
    locale.ts
    middleware.ts
  cache/
    cache-key.ts
    fragment-cache.ts
    redis-page-cache.ts
    request-coalescer.ts
    invalidation.ts
  commerce/
    client.ts
  rendering/
    controller.ts
    document-assembler.ts
    render-context.ts
    strategies/
      html-cache.ts
      data-cache.ts
      live-ssr.ts
      csr.ts
  components/
    DocumentShell.tsx
    Navigation.tsx
    Footer.tsx
    ProductList.tsx
    ProductCard.tsx
    UserMenu.tsx
    UserMenuSkeleton.tsx
    ProductListSkeleton.tsx
    ErrorPage.tsx
  client/
    user-menu.tsx
    product-list.tsx
    hydration-errors.ts
  routes/
    pages.ts
    bff.ts
    internal.ts
  observability/
    logger.ts
    timings.ts
scripts/
  generate-build-artifacts.tsx
  verify-build-artifacts.ts
  run-tests-with-report.ts
benchmark/
  runner.ts
  server.ts
  browser.ts
  scenarios.ts
  report.ts
  baseline/
tests/
```

controller 应依赖深模块接口，而不是在 route 中直接散落 Redis、React 和字符串组装逻辑。

## 5. 里程碑总览

| 阶段 | 内容 | 主要退出条件 |
|---|---|---|
| M0 | 基线与脚手架 | workspace 能识别并 type-check 三个新 package |
| M1 | 契约与业务服务 | 固定 catalog/user API 和 mutation/reset 可测 |
| M2 | Locale、key builder 与构建期产物 | 12 组合 fragments/shell/manifest 可验证 |
| M3 | 页面 controller 与无缓存渲染基线 | live SSR、CSR shell 和 document assembly 正确 |
| M4 | HTML/data 缓存、失效与降级 | 两种缓存策略及 TTL/coalescing/webhook/failure 测试通过 |
| M5 | Islands、CSR 数据流与个性化 | 四路径最终 DOM 一致，user menu 无 mismatch |
| M6 | 可观测性与 benchmark | quick/full、server/browser 报告可生成 |
| M7 | 完整测试与文档 | unit/integration/E2E/build verification 全绿 |
| M8 | 独立审查与收尾 | findings 已处理，最终 diff 和报告可追溯 |

## 6. M0 — 基线、工具链与 workspace 脚手架

### 任务

1. 记录实施前基线：
   - `git status`；
   - Node/PNPM 版本；
   - 根 `pnpm build`、`pnpm lint`、`pnpm type-check` 当前状态。
2. 创建三个 package，设置唯一 package name。
3. 为每个 package 创建现代 ESM TypeScript 配置，不继承旧 CommonJS/ES5 build 默认。
4. 固定 `engines.node` 为 Node 22 范围。
5. 页面服务配置 Vite client/server 双 mode：
   - client build 生成 hashed assets 和 manifest；
   - server build 使用已验证的直接 Vite SSR build；首期无需引入仅作透传的 Hono build plugin，官方 plugin 保留为部署/dev-server 需求出现时的可选迁移；
   - 多阶段构建时防止后一步清空先前 `dist` 产物。
6. 业务服务配置 Node server build。
7. 增加根/包级 scripts：
   - `dev`
   - `build`
   - `lint`
   - `type-check`
   - `test`
   - `test:e2e`
   - `benchmark:quick`
   - `benchmark:full`
8. 根据实际 Turbo 行为补充 outputs，但不升级 Turbo。
9. 增加 `compose.rendering-poc.yml` 和 `.env.example`，只负责本地 Redis 及必要配置说明。

### 验证

- `pnpm install` 正确链接 workspace packages；
- 三个 package 可独立 type-check；
- 根 Turbo 能发现其 scripts；
- `dist/**` 是唯一构建产物根；
- Vite manifest 可从 server build/runtime 定位。

### 退出条件

工具链稳定，后续阶段不再更换 runtime、SSR API 或输出目录。

## 7. M1 — 共享契约与 `commerce-api`

### 任务

1. 在 `commerce-contracts` 定义并导出：
   - `CountryCode`、`Language`、currency map；
   - catalog/product/user DTO schemas；
   - invalidation event discriminated union；
   - typed API error。
2. 创建固定 20 商品 seed：
   - 三种本地化文案；
   - 四国 minor-unit price；
   - 库存和稳定 data version。
3. 创建至少两个 mock 用户和积分数据。
4. 实现 `commerce-api` routes：
   - catalog；
   - user；
   - price/inventory/translation mutation；
   - reset；
   - health。
5. 对 query、params 和 body 执行 runtime validation。
6. mutation 成功后发送 signed/internal-token invalidation webhook。
7. webhook 失败时记录错误，但不回滚 mutation。
8. 增加结构化 request/error 日志。

### 测试

- 4 × 3 catalog 组合均返回正确 currency 与语言字段；
- reset 后数据与 seed 完全一致；
- price、inventory、translation mutation 只修改目标字段；
- mutation 发出正确 event payload；
- 非法 locale/body 返回稳定 4xx error schema；
- internal endpoint 无 token 时拒绝访问。

### 退出条件

业务服务可以独立启动、重置和稳定复现实验数据。

## 8. M2 — Locale、Vite assets 与构建期 fragments

### 任务

1. 实现 locale parser/canonicalizer：
   - URL 小写；
   - 内部 `GB` / `en-US`；
   - 合法非 canonical URL 308；
   - 非法值 404。
2. 实现 root redirect 和 locale preference cookies。
3. 建立 typed cache key builder：

   ```text
   v1:{artifactType}:{countryCode}:{language}:{pageKey}
   ```

4. 创建共享 React navigation/footer/user skeleton components。
5. 实现构建产物 generator，不访问业务 API。
6. 生成 12 组合 navigation/footer。
7. 生成 document shell、CSR fallback skeleton 和统一错误页。
8. 实现 slot verifier：缺失、重复或未知必需 slot 时构建失败。
9. 读取 Vite manifest 并形成 typed asset map。
10. 使用统一 key builder 实现进程内 LRU：`max=100`、`ttl=24h`，启动预热。
11. fragment miss 从磁盘产物恢复；损坏产物导致明确启动失败。

### 测试

- 12 组合产物全部存在且 key 唯一；
- key builder 拒绝非 allowlist artifact/locale/pageKey；
- navigation 只替换选择的国家/语言段；
- 显式 locale URL 不被冲突 cookie 覆盖；合法 cookie 驱动 root redirect，非法 cookie 回退默认 locale；
- fragment 不包含商品或用户 seed；
- shell 每个必需 slot 恰好一次；
- LRU eviction、TTL、prewarm、disk fallback 正确；
- hashed asset manifest 注入正确。

### 退出条件

没有 Redis、commerce API 或浏览器时也能完成确定性 build artifact generation。

## 9. M3 — 页面 controller、document assembly 与无缓存渲染基线

### 任务

1. 建立 `RenderContext`：request ID、locale、pageKey、strategy、timings。
2. 使用 M2 的统一 typed key builder，不在 route/strategy 中手写 key。
3. 实现 commerce HTTP client，包含 timeout、runtime validation 和 typed errors。
4. 实现统一 `ProductList`/`ProductCard` SSR component。
5. 实现 document assembler，只接受受信任的 typed inputs。
6. 定义 render strategy interface，并先实现：
   - `live-ssr` 完整页面；
   - `csr` document shell/fallback（暂不实现客户端 catalog 数据流）。
7. 注册 canonical route 解析与 strategy dispatch：

   ```text
   /:country/:language/benchmark/:variant/products
   ```

8. 确保 live SSR 在数据获取完成后才调用 `renderToString`。
9. 确保 CSR shell route 不调用商品 SSR、不读写 page Redis。
10. 为 M4 的 HTML/data strategy 留下窄接口，不在 controller 中提前嵌入 Redis 逻辑。

### 测试

- live SSR 返回完整商品 DOM；
- CSR route 返回 fragments、空 React root 和独立 fallback skeleton；
- live SSR 与 CSR shell 不产生 page Redis 操作；
- 非 canonical/非法 URL 行为符合规格；
- page title、`html lang`、country metadata 正确；
- strategy dispatch 不把 variant 写入 cache key。

### 退出条件

页面 controller、document assembly、live SSR 和 CSR shell 基线稳定；缓存策略与客户端数据流分别留给 M4/M5 完成。

## 10. M4 — Redis、coalescing、失效与故障降级

### 任务

1. 封装 Redis page cache，不允许 route 直接调用 Redis client。
2. 实现 `html-cache` 与 `data-cache` strategies，并接入 M3 strategy interface。
3. 实现 page HTML/data 30 秒 TTL。
4. HTML value 使用 `{ formatVersion, dataVersion, bodyHtml }` envelope；data value 使用 `{ schemaVersion, dataVersion, payload }` envelope。
5. data 读取时 runtime validate；不兼容 HTML/data envelope 按 MISS 处理。
6. HTML cache 只保存 business body，完整 document 每次组装。
7. 实现同进程、同 key request coalescing。
8. 实现 invalidation event expansion 和批量删除。
9. 实现页面服务 webhook endpoint 与 token validation。
10. 实现 benchmark reset/prewarm internal endpoints。
11. 实现 Redis/API failure mapping：
   - Redis failure -> bypass；
   - API failure + valid cache -> cache；
   - API failure + no cache -> 503；
   - invalidation failure -> TTL fallback。
12. 为 coalescing、invalidation、bypass 增加计数和 timings。

### 测试

- HTML/data hit、miss、expiry 独立；
- HTML/data envelope 版本不兼容时按 MISS 处理；
- HTML HIT 仍能记录 catalog dataVersion，value 不含 document/navigation/footer；
- 两个缓存 SSR route 与 live SSR 的初始商品 DOM 相同；
- 并发 miss 只有一个 API call/HTML render leader；
- rejected Promise 清理，不永久占用 coalescer；
- translation/price/inventory/reset 展开为正确 key 集合；
- Redis 断开时两种缓存策略可实时 SSR；
- API 断开时有/无缓存行为正确；
- 503 使用统一错误 body，不泄露内部信息。

### 退出条件

cold/warm/mutation/redis-failure 四种场景具备稳定、可观测的行为。

## 11. M5 — User island、CSR root 与 session

### 任务

1. 构建期 user-menu skeleton 与 client 首次 render 复用同一组件和 props。
2. 定义稳定 island ID 与 `identifierPrefix` 协议。
3. 使用 `hydrateRoot` 接管 user-menu，并配置 `onRecoverableError`。
4. hydration 后请求 `/api/me`。
5. 页面 BFF 验证签名 session cookie 后请求 `commerce-api` user endpoint。
6. 增加受开关保护的 demo session switch endpoint。
7. `/api/me` 返回 `private, no-store`。
8. CSR product root 保持空容器，使用 `createRoot`。
9. 静态 fallback skeleton 与 React root 明确分离，避免错误 hydration。
10. CSR catalog BFF 实时代理业务服务，不访问 page Redis。
11. 复用 SSR `ProductList`/`ProductCard`，完成 CSR 最终商品 DOM。

### 测试

- 四种 route 均能 hydration user menu；
- 首次 client render 与服务端 skeleton 完全一致；
- 无 hydration console warning/onRecoverableError；
- 切换 mock 用户后积分更新；
- page HTML/data/fragment 中搜不到用户字段；
- `/api/me` 明确返回 `private, no-store`，Redis spy 证明零 page-cache 操作；
- `/api/me` failure 不影响商品内容；
- CSR failure 显示可重试状态；
- CSR 完成后的商品 DOM 与三个 SSR route 相同。

### 退出条件

四种路径最终业务 DOM 一致，个性化 island 与共享页面缓存边界得到自动化证明。

## 12. M6 — 可观测性与 benchmark runner

### 任务

1. 为页面响应增加：
   - `X-Render-Strategy`；
   - `X-Cache`；
   - `Server-Timing`。
2. 实现结构化 JSON logs 和 request ID 传播。
3. 采集 response size、Redis/API/SSR/assembly timings、data version。
4. 采集 process CPU、RSS、heap 和 event-loop delay。
5. 实现 benchmark runner：
   - reset seed；
   - route 顺序轮换；
   - cold 每个隔离样本/burst 前 clear key；
   - warm 每个短于 TTL 的 segment 前 prewarm；
   - full profile 使用 3 × 20 秒 measured segments，总计 60 秒/round；
   - live/CSR 的 page-cache 状态标记 control / N/A；
   - mutation/redis-failure 场景。
6. 使用 autocannon 保存 warm 持续吞吐原始数据；cold 使用受控 serial samples 与 concurrent bursts。
7. CSR shell 与 catalog BFF 分开报告，并额外报告组合服务端事务；禁止与完整 SSR page response 放入同一吞吐排名。
8. 使用 Playwright 分别运行 cold-browser/warm-browser，并独立控制/记录 server-cache cold/warm；live/CSR server-cache 标记 N/A。
9. 记录 TTFB、FCP、LCP、商品可见、user-menu ready、assets bytes。
10. 实现 report generator，生成 JSON + Markdown + raw logs。
11. 记录 environment manifest：commit、dirty state、versions、OS、CPU、参数。
12. 创建一个明确标注机器环境的 baseline 示例。

### 验证

- `pnpm benchmark:quick` 完成并生成全部必需文件；
- full profile 保持 50 connections、60 秒 measured duration、5 rounds，且任何单段不跨越 30 秒 TTL；
- cold 结果来自每样本/burst 清理，而不是一次清理后的持续压测；
- CSR shell、CSR BFF 和组合事务标签明确；
- browser-cache 与 server-cache 状态均写入每个样本；
- 任一场景失败时报告仍保留已有 raw data 和错误；
- server/browser 指标不混合为单一误导性排名；
- Redis failure 后测试环境能自动恢复。

### 退出条件

另一位开发者按照仓库说明可独立复现实验并理解结果限制。

### 验收记录

- 真实 quick run：`benchmark/results/2026-08-22T204934-329Z-ea865659/`；22 个 server 结果、12 个 browser conditions、9 个 correctness checks，全部 schema-valid 且无 correctness failure。
- 本机基线：`benchmark/baseline/`；只保留 environment/server/browser/Markdown 摘要，不提交 raw logs，并明确禁止跨机器比较。
- full profile 的 160-result matrix 已通过 `pnpm benchmark:full -- --validate-only`，且 validate-only 不创建结果目录。
- M6 独立验收：无 blocker/high/medium；允许进入 M7。

## 13. M7 — 测试、报告与运行文档

### 任务

1. 配置 Vitest unit/integration reporters。
2. 配置 Playwright E2E project 和 artifact retention。
3. 每次测试生成 timestamped：
   - JUnit XML；
   - coverage summary；
   - Markdown test summary；
   - console log；
   - E2E trace/screenshot（失败时）。
4. 为以下矩阵补足测试：
   - 4 country × 3 language；
   - 4 render strategy；
   - hit/miss/bypass；
   - anonymous/authenticated user；
   - Redis/API healthy/failure。
5. 增加 build artifact verification command。
6. 编写运行说明：
   - Redis 启动；
   - 两服务启动；
   - demo session；
   - mutation；
   - quick/full benchmark；
   - 报告阅读方式。
7. 更新根 README 或加入指向本规格/运行说明的链接。

### 必跑命令

实际脚本名称以实现为准，但交付前至少运行：

```text
pnpm lint
pnpm type-check
pnpm build
pnpm test
pnpm test:e2e
pnpm benchmark:quick
```

记录每个命令的 exit code 和产物路径。

### 退出条件

所有正确性 gate 通过，任何未运行的昂贵验证均有明确原因。

### 验收状态

M7 实现与本地验证已完成；独立复审无 blocker/high，允许进入 M8。`benchmark:quick` 未在本次 M7 收尾重复运行，已有 M6 quick 结果可复查。

验收产物：
- root test：`test-results/2026-08-23T102420-724Z-1182aac4/`；11 workspace scope，102 tests，JUnit/coverage/log/Markdown 可解析。
- E2E：`test-results/2026-08-23T095414-060Z-9e6117ca/`；7/7 tests、Redis/API failure gate 通过。
- `pnpm build:verify`：24 fragments、3 templates 验证通过。

M8 review 修复：runner-safety 计划断言已同步；`.gitignore` 已覆盖 `.env.*` 且保留 `.env.example`；Redis BYPASS 已恢复按 page key coalesce、prewarm/clear/invalidation 对失败返回非 2xx 并由 commerce client 校验确认体；focused/root tests 均重新通过。

剩余风险：完整 `benchmark:full` 仍为昂贵的非 CI 阻断项；性能结论仅适用于记录的本机环境。

## 14. M8 — 独立审查与最终收尾

### 当前状态

M8 独立审查已完成；无 blocker/high/medium，最终收尾通过。

### 审查角度

实施完成后使用 fresh-context reviewer 分别检查：

1. 正确性与缓存边界；
2. React 19 hydration/island 行为；
3. benchmark 公平性与统计表达；
4. 安全、隐私和内部 endpoint；
5. 测试覆盖与可复现性；
6. 简单性、模块边界和不必要复杂度。

### 收尾流程

1. 父流程综合 review findings；
2. 只由一个 writer 修复接受的问题；
3. 对实质性修复再次做 focused review；
4. 重跑受影响命令和 quick benchmark；
5. 检查最终 diff、未跟踪文件和报告路径；
6. 不在未经授权时 commit、push 或发布。

### 退出条件

- blocker 已清零或明确记录并获准延期；
- 所有验收项都有测试、命令或人工证据；
- final summary 列出改动、验证、报告和剩余风险。

### M8 最终验收记录

- 正确性、hydration、benchmark 公平性、安全与测试报告均通过 fresh-context 独立审查。
- Root test：11 workspace scope，102 tests，0 failures；JUnit/coverage/log/Markdown 可解析。
- E2E：7/7 通过，Redis/API failure gate 通过；build verification：24 fragments、3 templates。
- Benchmark：quick 结果与 baseline 已通过 schema、raw identity、cache evidence、mutation complement 和 failure recovery 校验；full profile 已完成 160+12 identity validate-only。
- 遗留限制：full benchmark 未执行长负载；benchmark 结果仅适用于记录的本机环境，不支持跨机器绝对比较。

## 15. 验收追踪矩阵

| 规格要求 | 主要实现阶段 | 主要证据 |
|---|---|---|
| 四种相同页面方案 | M3–M5 | integration + E2E DOM comparison |
| 国家/语言解耦 | M1–M3 | 12 locale matrix tests |
| Build-time fragments | M2 | artifact verifier |
| LRU 与统一 key | M2–M4 | unit/integration tests |
| Redis HTML/data 对比 | M3–M4 | cache behavior tests + benchmark logs |
| 30 秒 TTL/主动失效 | M4 | fake-time + mutation integration |
| User island 个性化 | M5 | Playwright + cache content assertions |
| CSR 实时 BFF | M3/M5 | Redis spy + browser network assertions |
| 故障降级 | M4 | Redis/API failure tests |
| 服务端/browser 报告 | M6 | generated report artifacts |
| 所有测试留痕 | M7 | JUnit/log/coverage paths |

## 16. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Vite client/server build 相互清空产物 | 独立 outDir、显式 build 顺序、artifact verification |
| React hydration mismatch | 共享 skeleton、稳定 prefix、onRecoverableError、E2E console gate |
| CSR 以空 shell TTFB 误导结论 | 单独报告商品可见时间和 browser metrics |
| HTML/data 测试数据不一致 | 每轮 reset seed、data version、固定顺序轮换 |
| Redis failure 测试污染后续轮次 | runner 使用 try/finally 恢复并 health-check |
| Benchmark 受机器噪声影响 | environment manifest、5 轮、raw data、避免跨机绝对结论 |
| 用户数据泄漏到共享 cache | DTO 边界、cache content tests、`/api/me no-store` |
| webhook 丢失 | 30 秒 TTL 兜底并记录失败 |
| mutation 与旧 in-flight request 在失效后回填旧值 | 接受最多 30 秒陈旧窗口；envelope dataVersion 与 mutation benchmark 显式检测/报告 |
| CSR shell 与完整 SSR response 被错误排名 | shell、BFF、组合事务分表；最终体验看 browser benchmark |
| 内部 endpoint 被误暴露 | token、环境开关、默认关闭 demo mutation/session |
| 模块过度抽象 | 仅对 cache、render strategy、contract 建立明确深模块 |

## 17. 实施前审核清单

开始实现前确认：

- [ ] `spec.md` 的 URL、key、TTL 和四种策略仍获认可；
- [ ] 接受新增 `packages/commerce-contracts`；
- [ ] 本机或 CI 可使用 Node 22；
- [ ] 可以使用 Docker/本地 Redis；
- [ ] 接受完整 benchmark 不作为普通 CI blocker；
- [ ] 确认现有未跟踪文件不应被覆盖或删除；
- [ ] 明确第一位唯一 writer 和每个里程碑的 review gate。
