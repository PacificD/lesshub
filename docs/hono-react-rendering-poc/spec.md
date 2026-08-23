# Hono + React 混合渲染与缓存 Benchmark 规格

## 1. 文档状态

- 状态：已批准，实施中
- 范围：工程化 PoC，不作为生产上线承诺
- 页面服务：`apps/hono-react`
- 业务服务：`apps/commerce-api`
- 目标运行时：Node.js 22 LTS
- UI/SSR：React 19
- HTTP 框架：Hono + `@hono/node-server`
- 构建：Vite client/server 双构建

## 2. 目标

本项目用于可重复地比较同一电商商品列表页在不同数据获取、缓存和渲染边界下的表现。

必须做到：

1. Hono 作为 controller，负责页面路由、locale 解析、渲染策略选择、fragment/template 组装和响应。
2. `pnpm build` 生成稳定的公共 React fragment、页面 shell/fallback 和客户端 island assets。
3. 运行时动态业务数据不固化在构建产物中。
4. 四种方案使用相同业务数据和最终商品 DOM，并通过不同 URL 独立测试。
5. 同时比较服务端性能与浏览器用户可见性能，不以空 shell 的低 TTFB 代替真实可见速度。
6. 所有测试和 benchmark 均保存机器可读结果、原始日志和 Markdown 摘要。
7. 代码按接近生产的边界、类型、错误处理和可观测性实现，但避免引入与实验无关的平台复杂度。

## 3. 非目标

首期不包含：

- 多实例缓存失效广播；
- React streaming SSR 或 React Server Components；
- 数据库、消息队列、Redis Pub/Sub；
- 注册、OAuth 或完整生产鉴权；
- 商品详情页 benchmark；
- 结账、支付、订单履约；
- CDN/edge cache 对比；
- 自动断言某种渲染方案必须成为性能胜者；
- 升级仓库现有 PNPM/Turborepo 主版本。

## 4. 核心架构

```text
Browser
  |
  | locale page request / API request
  v
apps/hono-react (page controller / BFF)
  |-- build artifacts -> in-process LRU -> navigation/footer/shell
  |-- Redis -> page HTML body or page data
  |-- React 19 -> body SSR / island skeleton
  |-- Vite manifest -> client assets
  |
  | HTTP
  v
apps/commerce-api
  |-- deterministic in-memory catalog and users
  |-- mutation endpoints
  |-- invalidation webhook -> apps/hono-react

Redis
  |-- page-html
  `-- page-data
```

### 4.1 服务职责

#### `apps/hono-react`

- 解析并规范化国家、语言和页面路径；
- 选择四种 render strategy；
- 从 LRU 读取 build-time fragment；
- 从 Redis 读取/写入 HTML body 或 data；
- 调用 `commerce-api`；
- 使用 React 19 非流式 SSR；
- 组装完整 document；
- 承载 user-menu 和 CSR product-list 客户端 assets；
- 作为浏览器访问业务接口的 BFF；
- 接收缓存失效 webhook；
- 输出结构化日志与 `Server-Timing`；
- 提供 benchmark reset/prewarm 控制接口。

#### `apps/commerce-api`

- 提供固定 seed 的商品目录、国家价格、库存和用户积分；
- 提供 mutation 与 reset 接口；
- mutation 成功后通知页面服务失效相关 key；
- 不参与 HTML 渲染和页面 Redis 缓存。

### 4.2 共享契约

建议新增一个纯契约 workspace package，例如 `packages/commerce-contracts`，只包含：

- country/language/currency 类型；
- catalog、product、user DTO；
- runtime schema；
- invalidation event schema；
- API error schema。

两个服务通过 HTTP 交互，不能依赖彼此的运行时模块。共享 package 只共享协议，不共享服务实现。

## 5. Locale 与 URL

### 5.1 支持矩阵

| 国家 | 内部代码 | Currency |
|---|---:|---:|
| United States | `US` | `USD` |
| United Kingdom | `GB` | `GBP` |
| Japan | `JP` | `JPY` |
| Singapore | `SG` | `SGD` |

支持语言：

- `en-US`
- `ja-JP`
- `zh-CN`

国家与语言完全解耦，所有 4 × 3 组合均有效。例如 `GB + ja-JP` 使用日文文案和 GBP 价格。

### 5.2 Canonical URL

外部 URL 的 country 和 language 一律小写：

```text
/:country/:language/benchmark/:variant/products
```

示例：

```text
/gb/ja-jp/benchmark/html-cache/products
/gb/ja-jp/benchmark/data-cache/products
/gb/ja-jp/benchmark/live-ssr/products
/gb/ja-jp/benchmark/csr/products
```

规则：

- URL 中 `gb` 解析为内部 `GB`；
- URL 中 `ja-jp` 解析为内部 `ja-JP`；
- 大小写不规范但值合法时，308 跳转到小写 canonical URL；
- 不支持的 country/language/variant 返回 404；
- locale URL 是页面内容和共享缓存的唯一事实来源；cookie 不能覆盖显式 URL。

### 5.3 偏好 cookie

访问合法 locale 页面后保存：

- `lh_country=gb`
- `lh_language=ja-jp`

访问 `/` 时按 cookie 重定向；无 cookie 时使用 `/us/en-us/benchmark/html-cache/products`。切换国家只替换 country 段，切换语言只替换 language 段。

## 6. 电商业务模型

### 6.1 商品目录

固定 seed 生成约 20 个商品，每个商品包含：

- 稳定 `id` 和 `slug`；
- 按语言存储的 name/description；
- 按国家存储的 currency 与 minor-unit price；
- 全局库存；
- category、image URL、availability；
- 数据版本或 `updatedAt`，仅用于日志和一致性验证。

价格在服务端以整数 minor units 保存，格式化时使用语言控制格式、国家控制 currency：

```ts
new Intl.NumberFormat(language, {
  style: 'currency',
  currency: country.currency
})
```

### 6.2 用户

固定 seed 至少提供两个 mock 用户：

- id；
- display name；
- avatar；
- points；
- membership tier。

用户数据绝不进入 fragment、page HTML cache 或 page data cache。

### 6.3 建议业务 API

```text
GET    /v1/catalog?country=GB&language=ja-JP
GET    /v1/users/:userId
PATCH  /internal/products/:productId/price
PATCH  /internal/products/:productId/inventory
PATCH  /internal/products/:productId/translations/:language
POST   /internal/reset
GET    /health
```

mutation 与 reset 接口由内部 token 保护。

## 7. 构建期产物

### 7.1 构建原则

`pnpm build` 必须是确定性的，不能要求 `commerce-api` 在线，也不能把运行时商品价格、库存或用户信息写入产物。

构建步骤负责生成：

1. Vite client bundle 与 manifest；
2. 12 个 country/language 组合的 navigation fragment；
3. 12 个组合的 footer fragment；
4. document shell；
5. CSR 商品 skeleton/fallback；
6. 统一错误页 body；
7. Node server bundle。

所有产物输出到 `dist/**`，符合现有 Turbo build output 约定。

### 7.2 Fragment

公共 fragment 使用 React 19 `renderToString` 生成受信任 HTML：

- navigation；
- footer；
- user-menu 的稳定 SSR skeleton slot。

navigation 中的国家/语言切换由普通链接完成。user-menu 只包含匿名 skeleton 和 island 标识，不包含用户数据。

### 7.3 Document shell 与 slots

完整 document 使用显式、唯一的内部 slot token，例如：

```html
<!--slot:navigation-->
<!--slot:page-body-->
<!--slot:footer-->
<!--slot:client-assets-->
```

组装器必须：

- 验证每个必需 slot 恰好出现一次；
- 只注入构建期受信任 fragment、React SSR 输出和 Vite manifest 解析结果；
- 缺失或重复 slot 时失败并记录构建/启动错误；
- 不使用用户输入执行任意字符串替换。

## 8. React 渲染与 islands

### 8.1 SSR API

首期统一使用 React 19 `renderToString`：

- 它是非流式 SSR；
- 不宣称 progressive streaming；
- 页面数据在调用 React 前已经获取完毕；
- 首期页面组件不依赖服务端 Suspense 数据获取。

Streaming SSR 只能在后续独立 benchmark 中加入，不能悄悄改变这四组基线。

### 8.2 User menu island

四种页面都包含 user-menu island：

1. 构建期 React 输出稳定 skeleton；
2. 浏览器使用相同组件、相同初始 props 和稳定 `identifierPrefix` 调用 `hydrateRoot`；
3. hydration 后通过 Effect 请求页面服务 `/api/me`；
4. 页面服务读取签名 mock session cookie，再请求 `commerce-api`；
5. 成功后展示姓名、积分、会员级别和下拉菜单；
6. 失败时显示匿名或暂不可用状态，不影响商品内容。

禁止用 `suppressHydrationWarning` 掩盖 mismatch。开发和 E2E 中必须捕获 `onRecoverableError`，hydration mismatch 视为失败。

### 8.3 CSR product-list island

CSR 路径返回 document、公共 fragments 和商品 skeleton，但不包含 SSR 商品数据。

- React root 容器本身为空，使用 `createRoot`，不是 `hydrateRoot`；
- 静态 shell 可在 root 外提供 fallback skeleton；
- 客户端立即渲染 loading state，并请求页面 BFF；
- BFF 实时代理 `commerce-api`，不使用页面 Redis data cache；
- 数据到达后复用与 SSR 相同的 `ProductList`/`ProductCard` 组件；
- 最终 `data-product-id`、文本和层级结构与三种 SSR 路径一致。

首期商品卡不提供必须 hydration 的交互。SSR 三条路径不加载 product-list client bundle。

## 9. 四种渲染策略

四条路径共用 locale resolver、catalog DTO、React page component、document assembler、CSS 和公共 fragment。

### 9.1 HTML cache

```text
Redis page-html HIT
  -> body HTML
  -> assemble fragments + body

Redis page-html MISS
  -> commerce API
  -> React renderToString
  -> Redis SET body HTML EX 30
  -> assemble fragments + body
```

Redis 只缓存业务 body HTML，不缓存完整 document、navigation、footer、assets 或用户信息。

### 9.2 Data cache

```text
Redis page-data HIT
  -> validate/deserialize DTO
  -> React renderToString on every request
  -> assemble fragments + body

Redis page-data MISS
  -> commerce API
  -> validate DTO
  -> Redis SET data EX 30
  -> React renderToString
  -> assemble fragments + body
```

### 9.3 Live SSR

```text
commerce API on every request
  -> validate DTO
  -> React renderToString
  -> assemble fragments + body
```

不读写 page Redis cache，是服务端动态基线。

### 9.4 CSR

```text
server request
  -> assemble fragments + CSR shell/skeleton
  -> browser paints shell
  -> browser BFF request
  -> live commerce API
  -> createRoot renders products
```

CSR BFF 不读写 page Redis cache，是客户端动态基线。

## 10. Cache 规格

### 10.1 统一 key builder

LRU 与 Redis 必须调用同一个 key builder；业务代码禁止手写 key。

格式：

```text
v1:{artifactType}:{countryCode}:{language}:{pageKey}
```

示例：

```text
v1:fragment:GB:en-US:navigation
v1:fragment:GB:en-US:footer
v1:page-html:GB:en-US:products-list
v1:page-data:GB:en-US:products-list
```

约束：

- `countryCode` 和 `language` 使用内部规范值；
- `artifactType`、country、language、pageKey 均来自 allowlist/typed enum；
- route variant 不进入 key；HTML/data 由 artifact type 隔离；
- schema、HTML 结构或序列化不兼容变更时递增 `v1`；
- 日志默认记录 key hash，不向浏览器返回完整 key。

### 10.2 Fragment LRU

进程内缓存使用真实 LRU 实现（例如 `lru-cache`），不是 `node-cache` 包。

- `max=100`；
- `ttl=24h`；
- 服务启动时从 build artifacts 预热；
- fragment miss 可从磁盘产物重新载入；
- 不处理多实例广播；
- 动态业务 mutation 不失效 fragment。

### 10.3 Redis page cache

- HTML/data TTL 均为 30 秒；
- 两种 artifact type 独立统计 hit/miss；
- HTML value 使用 `{ formatVersion, dataVersion, bodyHtml }` envelope；
- data value 使用 `{ schemaVersion, dataVersion, payload }` envelope；
- HTML HIT 也能从 envelope 记录 catalog data version；
- data 读取后必须 runtime validate；
- HTML 只接受本服务生成的 React 输出；format/schema 不兼容时按 MISS 处理。

### 10.4 Request coalescing

同一进程、同一 key 同时 miss 时，只允许一个 Promise 回源/渲染；等待者复用该 Promise。

- HTML 和 data 使用不同 key，自然隔离；
- Promise 无论成功失败都必须清理；
- 记录 leader/waiter 数和等待耗时；
- 不做跨实例锁。

### 10.5 失效事件

`commerce-api` mutation 成功后向页面服务发送结构化 event，而不是直接拼 cache key。

建议 event：

```ts
type CacheInvalidationEvent =
  | { type: 'translation'; language: Language }
  | { type: 'price'; countryCode: CountryCode }
  | { type: 'inventory' | 'product'; scope: 'all' }
  | { type: 'reset'; scope: 'all' }
```

页面服务展开并删除 page-html 与 page-data keys：

| 变更 | 失效范围 |
|---|---|
| 某语言文案 | 该 language × 所有 country |
| 某国家价格 | 该 country × 所有 language |
| 库存/通用字段 | 所有 country × language |
| reset | 全部 page keys |

webhook 失败不回滚业务 mutation；30 秒 TTL 是最终陈旧上限。失败必须进入结构化日志。

## 11. Session 与个性化边界

- 页面服务提供仅供 PoC 的 demo session 切换端点；
- cookie 使用 HMAC 签名、`HttpOnly`、`SameSite=Lax`，生产 HTTPS 下启用 `Secure`；
- `/api/me` 不进入共享 Redis/page cache；
- user-menu 响应使用 `Cache-Control: private, no-store`；
- 用户 ID 不进入页面 URL、cache key、fragment 或共享日志字段；
- demo/internal endpoints 由显式环境开关或内部 token 保护。

## 12. 错误与降级

| 场景 | 行为 |
|---|---|
| Redis 不可用 | HTML/data 路径绕过 Redis，实时请求 API 并 SSR；`X-Cache: BYPASS` |
| API 不可用且已有有效 Redis cache | HTML/data 使用有效缓存 |
| API 不可用且无缓存 | SSR 返回统一错误 body，HTTP 503 |
| CSR catalog 请求失败 | 保留 shell，展示可重试错误状态 |
| `/api/me` 失败 | 用户菜单显示匿名/暂不可用 |
| fragment 预热失败 | 启动失败，不带残缺 shell 提供流量 |
| invalidation webhook 失败 | 记录错误，依靠 30 秒 TTL 收敛 |

错误页不能泄露 stack、Redis URL、内部 token 或业务服务地址。

## 13. 可观测性

### 13.1 响应头

页面响应至少提供：

```text
X-Render-Strategy: html-cache | data-cache | live-ssr | csr
X-Cache: HIT | MISS | BYPASS | NONE
Server-Timing: redis;dur=..., api;dur=..., ssr;dur=..., assemble;dur=...
```

### 13.2 结构化日志

每个请求记录：

- timestamp、request ID、route、status；
- country、language、pageKey、strategy；
- cache key hash、hit/miss/bypass；
- Redis/API/SSR/assembly/total durations；
- response bytes；
- coalescing role 与 wait duration；
- error code 和降级原因；
- catalog data version。

敏感 cookie、token、用户 ID 和完整 Redis key 不得写入普通请求日志。

## 14. Benchmark 规格

### 14.1 公平性约束

- 四种方案使用同一 seed、catalog DTO、React product components、CSS 和最终商品结构；
- 每轮开始前重置业务 seed；
- mutation 场景之外，测量期间禁止数据变更；
- route 执行顺序按轮次轮换；
- fragment LRU 对四组始终保持相同的启动预热状态；
- `cold` 在每个隔离样本或受控并发 burst 前清除目标 page key，不能用“一次清理后持续压测”代表 cold；
- `warm` 的单个测量 segment 必须短于 30 秒 TTL，每个 segment 前重新预热，预热时间不计入结果；
- live SSR 与 CSR 没有 page-cache cold/warm 状态，报告为 control / N/A，不能伪造缓存状态；
- reset/prewarm API 由 benchmark runner 调用，不依赖人工步骤；
- 报告环境、参数和失败，不跨机器直接宣称绝对性能结论。

### 14.2 场景

runner 对四种策略执行同一场景编排，但 cache-specific 状态只适用于 HTML/data：

1. `cold`：HTML/data 在每个隔离请求或并发 burst 前清除目标 key；live/CSR 标记 N/A；
2. `warm`：HTML/data 在每个短于 TTL 的 segment 前预热；live/CSR 作为无 page-cache control；
3. `mutation`：变更价格/库存，验证 HTML/data 主动失效与恢复，同时确认 live/CSR 读取最新数据；
4. `redis-failure`：验证 HTML/data 降级；live/CSR 记录为不依赖 page cache 的 control。

### 14.3 服务端 benchmark

持续吞吐使用 `autocannon`；cold 使用 runner 控制的隔离请求和并发 burst，不能用持续压测聚合值冒充 cold。

记录：

- requests/sec；
- p50/p95/p99 latency；
- error/timeout counts；
- CPU、RSS、heap、event-loop delay；
- response bytes；
- Redis/API 请求次数；
- cache hit/miss/bypass；
- SSR 与 assembly durations；
- coalescing leader/waiter。

Warm profiles：

| Profile | Connections | Measured duration per round | Segments | Rounds |
|---|---:|---:|---:|---:|
| quick | 10 | 10s | 1 × 10s | 1 |
| full | 50 | 60s | 3 × 20s，每段前预热 | 5 |

Cold protocol：

- serial cold latency：每个样本前清除目标 key，单请求测量；
- concurrent cold burst：每个 burst 前清除目标 key，再以 profile concurrency 同时发起请求；
- cold 报告 latency、burst completion、leader/waiter 和回源次数，不报告误导性的持续 cold RPS。

CSR 的页面请求只返回 shell，不能和包含商品的 SSR page response 放在同一吞吐排名：

- CSR shell endpoint 单独报告并标记 `shell-only / non-comparable`；
- CSR catalog BFF endpoint 单独压测；
- runner 另行报告 `shell + catalog BFF` 的组合服务端事务耗时与总请求成本；
- SSR 页面请求作为完整服务端事务；
- 最终用户体验以 browser benchmark 为准，不将 CSR shell RPS 解释为页面完成速度。

### 14.4 Browser benchmark

工具：Playwright。

每条路径至少采样 10 次，浏览器资源缓存与服务端 page cache 是两个独立维度：

- `cold-browser`：新 context，禁用 HTTP cache；
- `warm-browser`：每个 strategy 使用自己的复用 context，并先进行一次不计入结果的静态资源预热；
- `server-cache=cold`：HTML/data 在每个采样前清除目标 key；
- `server-cache=warm`：HTML/data 在每个采样前显式预热并确认 HIT；
- live SSR/CSR 的 `server-cache` 维度固定为 `N/A`；
- 报告必须同时写出 browser-cache 与 server-cache 状态，不能依赖测试顺序推断。

记录：

- TTFB；
- FCP；
- LCP；
- 商品可见时间；
- user-menu hydration ready 时间；
- catalog 请求时间；
- hydration recoverable errors；
- JS/CSS transferred bytes。

SSR 路径只加载公共 user-menu bundle；CSR 额外加载 product-list bundle。

### 14.5 报告

每次 benchmark 输出：

```text
benchmark/results/<timestamp>/
  environment.json
  server-summary.json
  browser-summary.json
  raw/
  benchmark-report.md
  run.log
```

`environment.json` 至少记录 git commit、dirty state、Node/React/Hono 版本、OS、CPU、内存、profile 和 runner 参数。

时间戳结果默认 `.gitignore`；仓库保留一个 `benchmark/baseline/` 示例基线。报告陈述数据、置信范围、异常和取舍，不预设胜者。

## 15. 测试与测试报告

### 15.1 测试层级

- Vitest unit：locale、key builder、LRU、coalescing、invalidation expansion、renderer、session；
- Hono `app.request()` integration：业务 API、页面 routes、cache hit/miss/bypass、错误状态；
- Playwright E2E：四方案最终 DOM、currency、locale、user-menu、CSR error、hydration errors；
- build verification：所有组合 fragment、slots、manifest 和 server bundle 存在。

### 15.2 命令

```text
pnpm test
pnpm test:e2e
pnpm benchmark:quick
pnpm benchmark:full
```

`benchmark:full` 不进入普通 CI 阻断链路。build/test 不以性能数值作为 pass/fail，只验证正确性、场景完成和报告完整性。

### 15.3 产物

```text
test-results/<UTC>-<id>/
  junit.xml
  coverage-summary.json
  test-report.md
  test.log

每次 `pnpm test:e2e` 也在 `test-results/<UTC>-<id>/` 直接生成：

```text
junit.xml
results.json
e2e-report.md
failure-gate.json
test.log
artifacts/ # 失败时保留 trace/screenshot
```
```

时间戳产物默认忽略，仓库保留一份示例报告。

## 16. 验收标准

### 功能正确性

- 四条路径在相同 seed 下展示同样的 20 个商品和最终业务 DOM；
- 4 个国家 × 3 种语言均可访问；
- country 只决定 currency/价格，language 只决定文案/格式语言；
- URL canonicalization、cookie 偏好和 404 行为符合规格；
- user-menu hydration 后显示 mock 用户积分；
- 共享缓存中不存在用户数据。

### 缓存正确性

- fragment LRU 使用统一 key builder，启动完成预热；
- HTML Redis envelope 的 `bodyHtml` 只含业务 body，不含 document/navigation/footer；
- data Redis value 通过 runtime validation；
- HTML/data 均 30 秒 TTL；
- mutation 主动失效范围正确；
- 并发 miss 只产生一次同 key 回源；
- Redis/API 故障按规格降级。

### React 正确性

- user-menu 服务端与客户端首次 render 完全一致；
- 多 root 使用稳定、成对一致的 `identifierPrefix`；
- CSR 空 root 使用 `createRoot`；
- E2E 无 hydration warning 或 `onRecoverableError` mismatch；
- 不使用 `suppressHydrationWarning` 掩盖错误。

### 实验可重复性

- quick/full server benchmark 可运行；
- cold/warm/mutation/redis-failure 均生成结果；
- cold/warm browser 结果分开；
- 每次运行保存 environment、raw data、log 和 Markdown report；
- 报告可追溯到 git commit 与完整参数。

## 17. 已知限制与后续扩展

- 单实例 request coalescing 和 webhook，不保证多实例一致性；
- 30 秒 TTL 不是强一致；mutation 与旧 in-flight request 存在“失效后回填旧值”竞态，首期接受最多 30 秒陈旧窗口并通过 dataVersion 检测、报告；
- 内存业务数据重启即恢复 seed；
- mock session 不等于生产身份系统；
- 本机 benchmark 受 CPU governor、后台进程和网络环境影响；
- `renderToString` 不支持 progressive streaming。

后续可独立增加 streaming SSR、CDN cache、multi-instance invalidation 和数据库，不得修改首期四条基线路径的含义。

## 18. 官方参考

- React `renderToString`: https://react.dev/reference/react-dom/server/renderToString
- React `renderToPipeableStream`: https://react.dev/reference/react-dom/server/renderToPipeableStream
- React `hydrateRoot`: https://react.dev/reference/react-dom/client/hydrateRoot
- Hono Node.js guide: https://hono.dev/docs/getting-started/nodejs
- Hono Vite build plugin: https://github.com/honojs/vite-plugins/tree/main/packages/build
- Hono Vite dev server: https://github.com/honojs/vite-plugins/blob/main/packages/dev-server/README.md
- Vite backend integration: https://vite.dev/guide/backend-integration
