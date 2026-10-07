# VERDANT 统一前端与币种指纹

2026-10-07。根据用户最新要求，将独立货币指纹整体融入 xjy，并将原有网站前端统一为 HTML、CSS、原生 JavaScript 和 Tailwind。本文取代旧文档中的前端框架、入口和布局说明；原有数据与执行安全边界继续有效。

## 产品结构

网站以币种为共同入口。每种已登记资产有稳定身份和指纹；市场数值存在时驱动形态，缺失时采用明确标记的中性参数。币种指纹不是信用分，也不会成为 Guardian 的交易授权或输入。

| 页面 | 内容与关联 | 数据边界 |
| --- | --- | --- |
| `/` | 焦点资产、研究入口、两列币种图鉴、搜索与筛选 | 默认读取公开快照；演示需手动选择 |
| `/coins/:id` | 币种资料、纹理/流体指纹、行情、来源、NFT 入口 | ETH 页面关联原有全部研究入口；其他币种明确显示未支持的研究范围 |
| `/guardian` | 原首页的策略表单、监控、单次运行、事件历史、Before/After 与独立核验 | 服务端配置的 MOCK/FORK；未接入指纹行情自动交易 |
| `/investigate` | 外层交易事实、指定池买卖证据、未知项、出处与下一步 | Ethereum 主网只读；保留原始金额精度 |
| `/risk-lab` | 风险曲线、输入指标、模型、证据和研究建议 | 继续显示明确的研究样本来源，不伪装实时预测 |
| `/position` | Aave 独立扩展保留，已从主导航、ETH 工作台及研究导航隐藏 | 主网只读；原深链接/API 保留，不进入当前展示主线 |
| `/attestations` | 固定、下载、导入报告，部署/发布/查询与内容核验 | 原报告哈希与待确认交易规则保留，BOT 968 |
| `/collection` | 指纹 NFT 的本地收藏记录 | 按钱包过滤；历史记录不是当前全链资产索引 |

行情图鉴初始覆盖 ETH、BTC、SOL、BNB、LINK、UNI、AVAX、DOGE。业务页面中的 WETH、USDC 使用同一身份注册体系，并有可访问的身份详情页；没有为它们捏造独立市场数值。Aave 聚合仓位不被改写为未知代币明细。

原 `/investigate`、`/risk-lab`、`/position`、`/attestations` 深链接保持有效；原首页的保护实验移至 `/guardian`。旧货币指纹的 `#/coin/...` 和 `#/collection` 链接可迁移到新路径。

## 统一设计

瑞士国际主义用于布局、网格、字号与信息分区；沿用 xjy 的配色与 VERDANT 品牌。

| 变量 | 色值 | 用途 |
| --- | --- | --- |
| paper | `#f7f1e7` | 页面背景 |
| sand | `#e8dcc7` | 浅色区域、低强调轨道 |
| ink | `#26352f` | 主文字、主要按钮和深色信息区 |
| ink-soft | `#5b6a60` | 次级说明 |
| moss / sage | `#606c38` / `#8b9d83` | 数据与辅助状态 |
| clay / clay-dark | `#c66b3d` / `#9d4d29` | 重点、曲线、交互反馈 |

字体统一为 Helvetica Neue / Arial 和系统中文无衬线；标题、模块、指标、来源形成明确层级。主结构用直线分隔，按钮与弹窗少量小圆角。去除大面积阴影、纸面噪声与各页面独立主题。指纹本身保留资产和数据颜色。

所有页面使用同一个 HTML 外壳、导航和 CSS。移动端规则在同一 CSS 中定义，不单独维护一套页面。

**D 原始交付未做浏览器或视觉检查。** 后续用户授权的集成阶段已实际操作首页、Guardian 与交易核验，见[新版验收](local-integration-acceptance.md#d-整合与发布前复验)。指纹 GPU、移动端排版与真实钱包交互仍待验收。

## 架构与运行

```text
web/
  index.html                 全站 HTML 外壳
  app.js                     资产页面、收藏、原生 URL 分发
  style.css                  Tailwind 入口与统一视觉系统
  ui.js                      格式化、资产身份、页面与表格构件
  fingerprint/
    data.js                  行情币种与计算口径
    render.js                Canvas 指纹、SVG、Shader Park
    nft.js                   指纹快照与钱包铸造
  pages/
    guardian.js              策略、监控与保护结果
    rescue-display.js        独立核验与压力图展示
    research.js              交易核验、Risk Lab、Aave
    attestations.js           报告存证完整流程
  public/                    图标与 NFT 合约构建产物
server/
  index.ts                   同源 HTTP、静态资源、Guardian 生命周期
  api.ts                     原 Request/Response 处理器分发
  fingerprint.js             公开市场数据适配与缓存
src/app/api/                 原 API 路径与合同
src/domain/, src/modules/, src/integration/
                             原 TypeScript 后端业务
```

前端不使用 React、Next、JSX 或 iframe。已有 Zod 校验、报告规范化哈希和 BOT 钱包工具作为共享业务模块被复用；它们编译为浏览器 JavaScript，不引入组件框架。原 `NextResponse.json` 改为标准 `Response.json`，接口路径、响应字段、错误码和来源头不变。

```sh
pnpm install
pnpm dev                # 默认 127.0.0.1:3000，使用配置与已有 Guardian 状态
pnpm build
pnpm start              # 同源提供 dist 与 API
```

服务优先级为显式进程环境 > `.env.local` > `.env`。原 `NEXT_PUBLIC_BOT_RPC_URL` 和 `NEXT_PUBLIC_BOT_REPORT_REGISTRY` 两个公开变量兼容保留，仅这两个指定值允许进入浏览器构建。私钥与其他服务端配置不注入前端。

原有状态数据库仍是 `.guardian/state.sqlite`。启动会按已有持久化意图恢复监控，保持旧业务规则；监听端口失败时不启动第二个监控实例。本轮验证没有读取或修改该生产状态目录。

不改变已有服务状态的预览：

```sh
pnpm build
pnpm dev:preview         # 127.0.0.1:3100，使用 output/unified-preview/state.sqlite
```

预览强制 MOCK，跳过 `.env*`，与原 Guardian 状态分开。预览保存的策略和事件不代表原业务账户。首次预览默认暂停；用户可以自行操作 Mock 实验。若 3100 被占用，设置其他 `PORT`。

## 迁移映射

| 原独立项目 | xjy 内位置 |
| --- | --- |
| `index.html`、`src/app.js`、`src/style.css` | `web/index.html`、`web/app.js`、`web/style.css`，已融入全站 |
| `src/data.js`、`src/fingerprint.js`、`src/nft.js` | `web/fingerprint/` |
| `server.mjs` | 数据适配进入 `server/fingerprint.js`；同源服务统一为 `server/index.ts` |
| NFT 合约、编译脚本、测试 | `contracts/CurrencyFingerprint.sol`、`scripts/compile-fingerprint.mjs`、`tests/fingerprint/` |
| PRD 与原始资料 | `docs/currency-fingerprint/` |
| `package-lock.json` | 依赖合入根 `package.json` / `pnpm-lock.yaml`，不维护第二套安装流程 |

原独立项目的 21 个源码、配置与文档文件已逐项归档到 Git 忽略的 `work/archive/currency-fingerprint-original/`，并核对 SHA-256。原目录被后台进程占用，因此仅保留运行缓存（node_modules、dist、output、.playwright-cli）和迁移说明，没有继续维护另一份源码；原 5173 预览已停止。归档不作为新的子站运行。实际产品源码、文档、合约和测试均已纳入仓库正常路径。旧 React 页面由 Git 历史保留，不再存在第二套可运行前端。

`next-env.d.ts` 在迁移初期因已有未提交修改而保留。后续用户授权仅清理前端遗留，其本地版本已备份到忽略的 `output/frontend-cleanup-backup/next-env.d.ts` 并核验 SHA-256，然后从仓库删除。JSX 配置和 CI 中的 `next typegen` 同步移除；旧 `.next` 缓存未删除。

## 验证与限制

```sh
pnpm typecheck
pnpm test               # 既有业务回归 + 新前端 DOM / API 分发测试
pnpm test:ui            # 仅原生前端行为，无浏览器/截图
pnpm test:fingerprint  # 计算口径与隔离本地 NFT 合约验证
pnpm contract:check    # 原报告存证合约与固定编译器一致
pnpm test:http         # 临时端口、独立 MOCK SQLite，实际 HTTP 闭环
```

HTTP 验证覆盖页面深链接、静态资源、同源限制、策略保存、未获批跳过、获批 Mock 运行、独立结果验证与重复事件拦截。该脚本创建自己的临时状态，不启动主网或 Fork 交易。

未配置 Fork RPC 与存证合约本地 EVM 的条件测试维持跳过，不把跳过计为通过。BOT 公共测试网实际部署/铸造、主网查询可用性和用户视觉验收不由这些检查替代。

本轮实际结果：TypeScript 检查和生产构建通过；Vitest **927 passed / 6 skipped**（包含 17 项新增原生前端/HTTP 分发测试）；指纹与本地 NFT 测试 **5 passed**；原报告合约编译一致性检查通过。隔离 HTTP 检查验证了 11 个页面路径、资源加载、同源限制、版本化策略、Mock 执行及重复事件拦截。3100 预览已返回 HTTP 200，初始为暂停的 MOCK 状态。

2026-10-07 行情更新：指纹默认读取公开快照，演示需手动选择；报价来自 Binance USDT 交易对，加载失败不补样本，过期缓存明确标注；新闻源失败不捏造结果；独立新闻情绪与全链 NFT 索引未实现。集成阶段已增加指纹交易刷新后受限恢复：只查询已保存的原 hash，无 hash 的未知广播保持占用，禁止自动重播；这是本地测试的安全能力，公开测试网交互尚未验收。新前端没有增加真实 AI 调查或把多币种浏览扩展为多币种执行。

## 流体形态的生产构建修复

用户反馈生产预览无法显示流体。非浏览器复现表明：未打包 Shader Park 可创建材质，但原生产包运行 DSL 编译时报 `ReferenceError: input is not defined`。这属于构建兼容故障，原“当前设备无法显示”的提示不足以描述原因。

现在由 `scripts/sculpture-source.mjs` 保存 DSL，`scripts/compile-sculpture.mjs` 在 `pnpm build` 时预编译为 `web/fingerprint/sculpture-shader.json`。浏览器只加载 `sculpture.js`、Three.js 和 GLSL，不再执行 Shader Park 的 JavaScript 编译器，也避免引入两份 Three.js。纹理绘制和 NFT SVG 未改变。

失败状态分别处理资源/初始化错误、WebGL 上下文创建失败、着色器编译失败和上下文丢失，异常时释放资源并回到纹理视图。

验证命令：先 `pnpm build`，再 `pnpm test:sculpture`。该回归会通过生产压缩构建创建 8 个币种的材质，禁止运行时 eval，校验生成着色器与源码一致；`tests/frontend/sculpture.test.ts` 检查初始化失败清理和上下文丢失等路径。验证不打开浏览器，不代表用户设备的实际 GPU 渲染或视觉已经验收。
