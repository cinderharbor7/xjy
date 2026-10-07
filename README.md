# Autonomous On-chain Risk Guardian

## ETH Crash Risk Lab demo

本次 ETH 链数据研究界面位于 [`/risk-lab`](http://localhost:3000/risk-lab)，API 为 `GET /api/eth-risk`。它使用经过 `OnchainSignalStateSchema` 校验的确定性链数据样本，展示卖压、波动率、杠杆、泡沫状态和左尾分位数五层模型，并把模型依据、置信度、证据引用和仓位建议放在同一页面。当前响应明确标记为 `MOCK_CHAIN_FIXTURE`，没有 RPC 读取、真实交易或实时预测；研究边界和替换真实 ETH 面板的步骤见 [`docs/eth-risk-lab.md`](docs/eth-risk-lab.md)。

An autonomous on-chain risk guardian that reduces exposure when abnormal risk appears.

> We don't drive your portfolio. We protect it when things go wrong.

产品目标是监控**一个 Ethereum 钱包及其 ETH 风险敞口**。观察 ETH 价格和链上资金行为，发现异常后，由 Agent 调查可能原因，读取并整理可核验的链上证据及置信度；当 Risk Score、Confidence、风险敞口和用户预设规则同时满足时，由 Policy 批准，将限定数量的 ETH 换成用户白名单中的防御资产。执行后重新读取钱包，验证 ETH 风险敞口确实下降。

链上证据应来自真实交易、区块、地址和数据来源，不能由 Agent 编造；Confidence 表示证据对调查结论的支持程度，不是 ETH 必然继续下跌的概率。系统验证的是敞口降低，不保证每次转换都减少最终损失。

用户决定什么时候承担投资风险。系统只在异常风险出现时，按用户提前设定的硬规则，把部分风险资产转换成用户白名单中的防御资产。**NOT an AI trading bot.** 不做自动抄底、加仓、重新入场、收益优化或杠杆。

比赛 MVP 只有 `NONE` 和 `SWAP_TO_SAFE` 两种动作：允许 `RISK → DEFENSIVE`；禁止 `DEFENSIVE → RISK`。Demo 使用 ETH → USDC，USDC 在这里是 **user-approved defensive asset**，不表示绝对安全或无风险。

## 当前实现状态（团队集成分支）

本分支 `codex/integrate-guardian` 从 main `bc1d504` 开始，整合 A、B、C、D 的交付，保留配置 API/表单、固定钱包绑定、服务端监控、SQLite 持久化和 Fork 装配。**该版本通过 PR 供团队评审，尚未合入 main。A→B 已有真实数据的独立只读分析入口；交易监控仍使用明确标记的 Demo 风险输入和 Mock investigation。**

| 内容 | 当前状态 |
| --- | --- |
| 共享 Zod / TypeScript 合同、Policy / Execution 权限边界 | 保留原合同；C 的配置校验入口已复用 |
| 配置 GET/PUT 与表单 | 单钱包持久化、版本冲突、支持资产列表；每次执行冻结同一策略快照 |
| 服务端监控 | 10 秒一次；前端只启动、暂停和查询；服务重启恢复启停意图与事件 |
| 一次风险事件一次 swap | SQLite 事件预占、跨请求租约、广播前哈希持久化；手动入口共享去重 |
| 未知回执与验证失败 | 未知只查已知 hash；验证失败保留事件并停止新交易，不能启动绕过 |
| 市场恢复 | 连续 3 个有效新鲜样本；波动率 ≤40、5m ≥−0.5%、1h ≥−2%；D 演示参数，待 B 校准 |
| Fork 余额与现价 | A 的 ForkObservationReader：WETH/USDC 余额、链上 decimals 与 V2 池现价绑定同一 canonical block/hash/time；原生 ETH 只作 gas |
| Fork 执行 | 本机 Anvil、同一 signer/recipient、WETH→USDC；独立新读取验证效果 |
| 风险变化和调查 | 明确演示输入；仍使用 Mock investigation / confidence，不声称实时异常调查 |
| A 主网只读数据 | 原生 ETH + USDC、Chainlink 当前/历史行情、Uniswap V3 单池卖压；独立只读入口，不与 Fork WETH 余额混用 |
| B 卖压分析 | A 的真实共享快照 → B 规则评分和有来源的调查输出；Confidence 为未校准启发式，分析入口不调用 Policy/Executor |
| 链上信号合同 / Risk Lab | `OnchainSignalState` / `OnchainEvidence` 保持冻结；研究页样本独立于交易流程 |

完整运行步骤、HTTP 合同、错误码、状态机、A/B/C 交接和验收方式见 [D 监控与 Fork 集成](docs/guardian-monitor.md)。原始需求与 C 分工说明保留于 [D2C-handoff.md](D2C-handoff.md)。

### 已确认规则

本机 Fork、固定一个测试钱包；同一次风险事件只允许一笔获批减仓 swap，approve 不另计减仓。成功后继续观察，只有独立市场信号恢复、随后再次满足完整策略，才允许下一个事件。交易未知、失败或效果验证失败不能通过刷新、暂停/恢复、配置变化或重启自动重卖。当前仅 WETH→USDC；原生 ETH 用于 gas。USDC 为用户批准的防御资产，不代表绝对安全。

## 安装与运行

需要 Node.js **22.13.0 或更新版本（推荐 Node 24 LTS，使用 node:sqlite）**、pnpm **11**；仓库固定 pnpm 11.7.0。

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，默认绑定示例钱包且处于暂停状态。在页面保存策略并启动监控，或点击 Run rescue loop 手动运行一次。手动与自动入口共享事件去重，重复点击不再重置模拟钱包。

默认 `GUARDIAN_MODE=MOCK`，无需 RPC、Key 或钱包连接。只有显式 `GUARDIAN_MODE=FORK`、匹配的固定钱包/本机私钥、loopback RPC 和有效 Anvil Fork 元数据才可进入 Fork 模式；`MOCK_MODE=false` 本身不能开启交易。见 [.env.example](.env.example)。运行记录保存在 Git 忽略的 `.guardian/`，不得通过删除状态绕过去重。默认 dev/start 命令绑定 127.0.0.1，仅在本机运行，不暴露到公网或反向代理。

检查命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

构建后可用 `pnpm start` 运行生产服务。`.env*` 已被 Git 忽略，仅 `.env.example` 可提交；不提交真实私钥或 API Key。

## A 真实只读数据验收

`.env.local` 设置 `ETHEREUM_RPC_URL` 后运行：

```bash
pnpm data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --only portfolio
pnpm data:read --only market
pnpm data:read --only signal
pnpm --silent data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json
```

输出标记 **LIVE_READ_ONLY**。钱包总值仅覆盖原生 ETH 与 USDC；行情是 Chainlink oracle，`volatilityScore` 是已批准的 1h 价格变化代理；卖压仅覆盖 Uniswap V3 WETH/USDC 0.05% 单池。基线为零、RPC/报价/区块异常明确失败，不回退 Mock。命令只读取一次，不启动持续监控。

B/D 的稳定服务入口是 `createEthereumDataServices()`，分别返回 `PortfolioState`、`MarketState`、`OnchainSignalState`；出处由 `OnchainEvidence` 表示。安装、完整口径、接口用法与验收标准见 [ethereum-data.md](docs/ethereum-data.md)。需要一次共同快照时使用 `readEthereumData(client, { section: "all", wallet })`。首页与 `POST /api/rescue` 的实际模式由 `GUARDIAN_MODE` 显式决定。

## A→B 真实只读分析

```bash
pnpm data:analyze --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json
```

`src/integration/onchain-analysis.ts` 将 A 的同一主网快照交给 B 的 `OnchainAnalysisService`。输出保留 `LIVE_READ_ONLY`、真实数据/引用和冻结的 `RiskAnalysis`，并标记 `SELL_PRESSURE_HEURISTIC`。评分复用市场/敞口规则，1×卖压不加分，3×及以上最多加30分，总分封顶100；Confidence 最高0.9，按去重引用与交易数量计算，不能当作价格下跌概率或链上真实性验证。没有真实 LLM、签名、Policy 执行或后台监控。任何读取失败整体失败，不使用旧数据或 Mock 补齐。

这条主网只读分析与本机 Fork 的交易演示分别验收。B 尚未交付真实卖压事件的恢复判据，因此它未接入持久化交易监控；现有恢复条件仍为 Demo 参数，不能称为完整实时 Agent 自动交易。

## 架构纠偏前后

原核心流程：

```text
Ethereum / Aave → PositionService → PositionState
  → HF 风险和压力测试 → Investigation
  → HF / debt / confidence Policy → REPAY
  → 再次读取 PositionState → 比较 Health Factor
```

现在核心流程：

```text
Wallet / Blockchain → PortfolioService → PortfolioState ─┐
Market Data → MarketService → MarketState ────────────────┤
                                                        ↓
Risk Engine → Investigation Agent → RiskAnalysis
  → Policy Engine → PolicyDecision
  → Mitigation Executor → ExecutionResult
  → Blockchain → PortfolioService 再次读取 PortfolioState
  → verification → Dashboard
```

默认外部世界由 Mock Adapter 模拟；显式 Fork 模式使用真实本机余额/成交和演示分析输入。Orchestrator 管流程，服务通过 Zod 数据合同通信。Risk Engine 做确定性计算；Agent 解释事件、原因、证据与不确定性，没有 Executor 引用。Policy 使用服务端用户预设阈值和资产名单，Agent 建议或文字不构成批准。Executor 只接结构化 `PolicyDecision`，并独立检查可信名单、方向和限额。

核心不再要求 collateral、debt、healthFactor 或 Aave：`PositionState` 换为 `PortfolioState`，HF 压力测试换为组合价值压力测试，HF/债务触发条件换为风险分数、可信度、风险敞口与白名单，`repay()` 换为 `execute(decision)`。保留服务/Adapter 分层、Risk、Investigation、Policy、Execution、RescueOrchestrator、API 和现有页面/CSS体系。

交易成功和保护效果分开记录。成功执行后必须独立重读 Portfolio；验证钱包、重读时间不早于执行、区块不倒退、资产身份/方向、数量变化与回执一致、按市场报价核对批准百分点，以及风险敞口下降，才得到 `verification.status: "PASSED"`。执行成功但效果不符返回真实 `after` 和 `FAILED`，系统停止；未批准或执行失败为 `SKIPPED`。重读失败明确报错，不能采用 Executor 提供的“执行后组合”。

## 固定 Mock 闭环

| 阶段 | Demo 数据 |
| --- | --- |
| Portfolio Before | 10 ETH，ETH $3,000；0 USDC；总值 $30,000；风险敞口 100% |
| Market Shock | ETH $3,000 → $2,700；5m -3%，1h -10%，volatilityScore 82 |
| Risk / Agent | Risk Score 91；Confidence 0.88；调查和证据明确标记 Mock |
| Policy | score > 80、confidence > 0.85、exposure > 70，ETH/USDC 在用户预设名单内 |
| Action | `SWAP_TO_SAFE`；降低 **30 个百分点**；Mock 3 ETH → 8,100 USDC |
| 独立重读 | 7 ETH = $18,900；8,100 USDC；总值 $27,000；风险敞口 70% |
| Verification | `PASSED`，风险敞口 100% → 70%，到此停止 |

`reduceExposurePct` 和 `maxDeRiskPct` 的单位是**风险敞口百分点**：80% 降低 30 个百分点是 50%，不是 56%。Mock 按执行时组合总值 × 批准百分点 / 100 计算转换金额。Demo 中执行时总值 $27,000，30 个百分点对应 $8,100，即 3 ETH。USDC 按 $1 模拟，不模拟手续费、滑点或真实流动性。

Before 的 $30,000 与 After 的 $27,000 相差 $3,000，来自 ETH 的模拟市场跌价；转换本身没有在 Demo 中造成这笔损失。Market Mock 更新请求内外部世界的 ETH 估值，Portfolio 的首读保留冲击前快照，执行后的重读使用冲击后价格。

风险公式是 Demo 的确定性规则：

```text
riskScore = round(0.5 × volatilityScore
                + 0.3 × clamp(-priceChange1hPct × 10, 0, 100)
                + 0.2 × riskExposurePct)
```

没有风险资产时 score 为 0。压力测试对 **before 快照**的风险资产部分施加 -5% / -10% / -15%，防御资产估值暂固定；Demo 输出 $28,500 / $27,000 / $25,500，损失 $1,500 / $3,000 / $4,500。它不是在 $2,700 的当前价上再跌一次的预测。调查前 confidence 为 0，调查后采用 Mock Investigation 的 0.88。

上表描述首次默认 Mock 场景。HTTP 和监控入口保存前次余额与事件，不会每轮重置；仅底层独立 fixture 工厂供模块测试使用请求级新状态。恢复后下一事件还须满足敞口、分数、置信度和白名单等完整策略。

## 模块与四人交接

```text
src/
  domain/
    schemas/              # Guardian 核心 Zod 合同
    types/                # 从 Zod infer 的类型
    verification.ts       # 重读后的实际效果检查
  modules/
    portfolio/            # 钱包组合服务与 Adapter
    market/               # 独立行情服务与 Adapter
    onchain/              # A 主网采集、链上合同服务、Fork canonical 读取器
    risk/                 # 确定性风险和压力测试
    investigation/        # 调查接口、服务、Mock Agent
    policy/               # 用户预设硬规则、资产白名单
    execution/            # 结构化单向减风险执行
    rescue/               # 编排与重读
  mocks/scenarios.ts      # 请求级模拟外部世界
  integration/rescue.ts   # 手动运行入口与独立 Mock fixture
  integration/onchain-analysis.ts # A→B 单次真实只读分析
  integration/guardian/   # D 持久化、监控、模式装配、Fork身份及签名日志
  instrumentation.ts     # 服务启动后恢复服务端定时循环
  extensions/aave/        # 可选的独立真实只读扩展
  app/
    api/rescue/           # 手动运行，共用事件门控
    api/policy/           # 版本化配置读写
    api/monitor/          # 启动、暂停和状态查询
    api/position/         # Aave 扩展 API
    position/             # Aave 扩展只读页面
    page.tsx              # Guardian Dashboard 与配置/监控控件
tests/
```

| 开发者 | 主要目录 | 下一步职责 |
| --- | --- | --- |
| A | `src/modules/portfolio/`、`src/modules/market/`、`src/modules/onchain/` | 钱包余额、行情及链上资金数据；与 D 统一 Fork WETH/USDC 余额和报价口径；按冻结的 `OnchainSignalState` 输出独立信号，不与 Portfolio 混用 |
| B | `src/modules/risk/`、`src/modules/investigation/` | 消费链上信号与证据，开发异常识别、风险计算、压力测试和调查；与 D 定义市场风险恢复条件；只输出分析，不获得交易权限 |
| C | `src/modules/policy/`、`src/modules/execution/` | 策略配置校验、白名单、额度与受限执行；修正并交付 Fork adapter、执行状态和接入说明，配合 D 防止重复交易；不负责 HTTP 路由或前端 |
| D | `src/app/`、`src/integration/`、`src/modules/rescue/` | 配置 API/表单与存取、Dashboard、服务端持续监控、事件状态/去重/恢复、Fork 装配及执行后的独立重读和效果展示 |

此表描述职责边界，不代表各模块均已完成。A/B 的数据交接边界已冻结；C/D 按 [D2C-handoff.md](D2C-handoff.md) 修改和联调，公共合同由集成负责人协调，不能各自修改后默认兼容。

`src/domain/` 是共同稳定边界，`src/mocks/` 与公共配置由集成负责人协调，顺序整合变更。Adapter 实现由各负责人维护，D 在 composition root 注入；业务层不知道具体 Mock 类型。可选 Aave 扩展单独维护，不能作为新 Portfolio 或短周期 Market 的替代源。

## 数据合同与 API

全部核心 schema 的字段、范围和跨字段约束见 [contracts.md](docs/contracts.md)。三项核心边界为 `PortfolioState`、`RiskAnalysis`、`PolicyDecision`；`MarketState` 独立存在。Zod 是唯一真源，TypeScript 类型由 `z.infer` 推导。对象严格拒绝未知字段。

### A→B 链上数据交接

两个新增合同从公共入口导入：

```typescript
import { OnchainSignalStateSchema, OnchainEvidenceSchema } from "@/domain/schemas";
import type { OnchainSignalState, OnchainEvidence } from "@/domain/types";
```

A 输出 `OnchainSignalState`，包含 ETH 卖压类型、UTC 观察窗口、当前与基线卖出美元额、异常倍数、交易数、钱包数及 `OnchainEvidence[]`。B 消费同一个结构，结合证据做调查；证据与 Agent 建议均不构成执行授权。C 继续以 PolicyDecision 为执行入口，D 负责后续装配。

- 当前窗口为 `[windowStart, windowEnd)`；基线是紧邻之前的一个等长窗口。
- 卖出额统计 ETH **总卖出额，不减买入**；`anomalyRatio = currentSellVolumeUsd / baselineSellVolumeUsd`，表示倍数，不是百分比。
- 基线必须大于 0；为 0 时拒绝生成有效信号。当前卖出额可以为 0。
- `txCount` 按 ETH 卖出交易的 txHash 去重，`uniqueWallets` 按这些交易的原始 `tx.from` 去重，不使用 router/池地址。
- `TRANSACTION` 必填 txHash；`BLOCK` 必填 blockHash；`CONTRACT_EVENT` 必填 txHash 与 contractAddress。三类均要求 blockNumber、description、source。

完整字段、校验规则、证据抽样口径和可解析 JSON 示例见 [链上合同](docs/contracts.md)。格式校验不证明链上事实，A 负责真实来源，B 负责证据对结论的支持程度。本次没有修改现有 Investigation 签名、`string[]` 证据、RescueSession 或 API。B 已通过构造时绑定信号消费冻结合同；交易监控的真实信号装配和恢复规则仍由 B/D 后续共同交付。

```http
POST /api/rescue
Content-Type: application/json

{"wallet":"0x1111111111111111111111111111111111111111"}
```

HTTP 200 保持 `RescueSession`：before、market、riskAnalysis、policyDecision、execution、可选 after、必填 verification。`X-Rescue-Mode` 为实际 MOCK/FORK，响应不缓存。仅接受服务端绑定钱包；忙碌、事件占用返回 409，配置/观测不可用返回 503，其他错误码见监控文档。使用独立 `GuardianProblemSchema` 的 `application/problem+json`，不暴露原始异常。rescue 请求不能覆盖动作、配置、RPC 或执行权限；配置通过独立版本化 PUT 保存。

URL 保留，但响应**整体替换**旧借贷合同，不维护旧 `PositionState` / `REPAY` 响应格式。完整机器合同见 [rescue-api.openapi.json](docs/rescue-api.openapi.json)。

## 可选 Aave 只读扩展

已有真实 Aave 查询保留在 `src/extensions/aave/`；`/position` 和 `POST /api/position` 路径及 ACTIVE / NO_DEBT 响应保持。它读取 Ethereum 主网 Aave V3 Core 聚合抵押、债务、HF、WETH/USD oracle 及前 7200 区块变化，保留地址/区块证据，没有钱包、签名或写链能力。

该聚合数据不是整个钱包组合；7200 区块窗口不是精确 24 小时，也不是新核心的 5m / 1h 行情。扩展使用本地 `AavePositionState` 合同，不向主 Risk / Policy / Executor 传递数据。新核心不导入扩展，扩展也不导入新核心 Domain。

仅使用扩展时才需要 `.env.local` 服务端配置：

```dotenv
MOCK_MODE=true
ETHEREUM_RPC_URL=https://eth.drpc.org
AAVE_NETWORK=ethereum-mainnet
```

RPC 必须支持最近 7200 区块历史 `eth_call` 与 EIP-1898 `blockHash` / `requireCanonical`；没有备用端点、重试或 Mock fallback。公开 RPC 示例可用性可能变化。配置修改后重启服务。详情与测试钱包见 [aave-position.md](docs/aave-position.md)，机器合同见 [position-api.openapi.json](docs/position-api.openapi.json)。

## 当前 Mock 与实际能力

**默认 Mock：** 钱包资产余额、行情冲击和历史变化、Agent 解释与 confidence、执行及假 txHash。**显式本机 Fork：** WETH/USDC 余额、池现价、批准额度签名/成交、回执和独立重读是真实本机链操作；历史变化与调查仍为演示。两种模式均有 SQLite 持久化，不提供主网执行、真实 LLM 或多链能力。

**A→B 实际只读能力：** 原生 ETH + USDC、Chainlink 当前/历史报价、V3 单池 gross sell-pressure、B 规则分析和有来源的引用；置信度/风险模型未拟合校准，无真实 LLM，不广播交易。

**实际运行的工程能力：** Zod/TypeScript 合同、确定性评分和压力测试、Policy 硬门控、Executor 名单/方向/限额检查、流程编排、独立重读、效果验证、API/UI 与测试。**独立扩展中的实际链上能力：** Aave 只读查询；它与主 Guardian 的本机 Fork 执行相互独立。

OpenAPI 文档验证范围为 JSON 解析、内部引用及示例对 Zod 合同的检查；仓库没有专门 OpenAPI 规范校验器，未声称完成完整 OpenAPI 规范验证。

## 验收标准

- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- [ ] 两个链上合同可从公共入口导入；测试验证三类证据必填引用、零基线拒绝、ratio 一致性、UTC 窗口、计数关系及未知字段拒绝。
- [ ] 无真实 Key/RPC 时启动核心页面，明确显示 MOCK MODE。
- [ ] Run Demo 展示 10 ETH / $30,000 / 100% → 模拟 $3,000 → $2,700 → Risk 91 / Confidence 88% → Policy Triggered → Mock 3 ETH → 8,100 USDC → 独立重读 7 ETH / 8,100 USDC / 70% → PASSED。
- [ ] 压力测试基于 before 快照；页面区分市场报价、演示风险输入和执行结果。
- [ ] Policy 条件不满足或等于阈值时，Executor 调用次数为 0。
- [ ] Executor 拒绝未批准、自由文本、反向、陌生资产、非白名单及超限决定；Agent 无法绕过 Policy。
- [ ] 测试覆盖 80% 降低 30 个百分点 → 50%，不是出售风险资产的 30%。
- [ ] 成功执行后确实再读 Portfolio；执行失败无 after，未改善或余额证据不符为 FAILED 并停止，重读失败明确报错。
- [ ] 多次/并发请求共享事件门控；每次市场风险事件最多一笔获批 swap，无自动重新入场。Mock hash 与本机 Fork hash 均明确标识。
- [ ] `/api/rescue` 严格输入与新 DTO/verification/error 合同一致；旧借贷格式不继续输出。
- [ ] Aave 的 3 个专项测试保持通过；现有读取路径/字段/错误/NO_DEBT/canonical 要求不变，主核心不依赖它。

本轮团队集成验收项（新鲜执行结果见 [team-integration-acceptance.md](docs/team-integration-acceptance.md)，历史 D 验收记录单独保留；未作浏览器视觉验收）：

- [ ] 固定测试钱包、签名地址、Fork 链配置和 WETH/USDC 读取一致，配置保存后按约定生效。
- [ ] 服务端持续监控，在完整策略满足时自动执行；同一事件持续超标不重复 swap。
- [ ] 只有市场风险满足恢复条件后再次超标，才建立新事件；减仓、数据缺失、重启和暂停/恢复不绕过去重。
- [ ] 交易待确认时不重新广播 swap，执行后独立重读并如实展示 PASSED/FAILED；明确失败和验证失败的处理符合交接约定。
- [ ] 页面正确区分 Mock、Fork 交易和演示分析输入；完成监控 → Policy → Fork 执行 → 重读 → 展示的全流程验收。

- [ ] A→B 同一个真实观察周期输出可校验 RiskAnalysis、原始信号和可核查引用；正常/低卖压不会描述为升高，重复引用不增加 Confidence。
- [ ] Fork Portfolio 时间来自实际区块；before 和报价共块，after 独立读取；执行时间来自已确认回执所在 canonical block。
- [ ] Mock 余额经过 NONE 观察和重启仍保留，失去租约的迟到结果不覆盖已经确认的事件。
