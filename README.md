# Autonomous On-chain Risk Guardian

## ETH Crash Risk Lab demo

本次 ETH 链数据研究界面位于 [`/risk-lab`](http://localhost:3000/risk-lab)，API 为 `GET /api/eth-risk`。它使用经过 `OnchainSignalStateSchema` 校验的确定性链数据样本，展示卖压、波动率、杠杆、泡沫状态和左尾分位数五层模型，并把模型依据、置信度、证据引用和仓位建议放在同一页面。当前响应明确标记为 `MOCK_CHAIN_FIXTURE`，没有 RPC 读取、真实交易或实时预测；研究边界和替换真实 ETH 面板的步骤见 [`docs/eth-risk-lab.md`](docs/eth-risk-lab.md)。

An autonomous on-chain risk guardian that reduces exposure when abnormal risk appears.

> We don't drive your portfolio. We protect it when things go wrong.

产品目标是监控**一个 Ethereum 钱包及其 ETH 风险敞口**。观察 ETH 价格和链上资金行为，发现异常后，由 Agent 调查可能原因，读取并整理可核验的链上证据及置信度；当 Risk Score、Confidence、风险敞口和用户预设规则同时满足时，由 Policy 批准，将限定数量的 ETH 换成用户白名单中的防御资产。执行后重新读取钱包，验证 ETH 风险敞口确实下降。

链上证据应来自真实交易、区块、地址和数据来源，不能由 Agent 编造；Confidence 表示证据对调查结论的支持程度，不是 ETH 必然继续下跌的概率。系统验证的是敞口降低，不保证每次转换都减少最终损失。

用户决定什么时候承担投资风险。系统只在异常风险出现时，按用户提前设定的硬规则，把部分风险资产转换成用户白名单中的防御资产。**NOT an AI trading bot.** 不做自动抄底、加仓、重新入场、收益优化或杠杆。

比赛 MVP 只有 `NONE` 和 `SWAP_TO_SAFE` 两种动作：允许 `RISK → DEFENSIVE`；禁止 `DEFENSIVE → RISK`。Demo 使用 ETH → USDC，USDC 在这里是 **user-approved defensive asset**，不表示绝对安全或无风险。

## 当前完成状态与开工准备

截至 2026-10-07，**main 中已完成的是 Guardian 工程骨架和单次运行的 Mock 闭环，尚未接入真实链上异常调查、持续监控或 Fork 自动换币**。C 的 `c/policy-execution` 分支已有 Fork 执行适配器和测试代码（审阅基线 `2c2db4a`），尚未合入 main 或完成 HTTP → orchestrator 全流程验收。上述产品目标不代表这些能力已在主流程实现。

| 内容 | 当前状态 |
| --- | --- |
| Portfolio / Market / Risk / Investigation / Policy / Execution / RescueSession 核心契约 | Mock 阶段已冻结，Zod 与 TypeScript 类型已实现 |
| Agent 无执行权、Policy 硬门控、白名单、单向转换、额度和独立重读验证 | 已实现并有测试 |
| 首页和 `POST /api/rescue` | 已实现，点击一次运行一次固定 Mock 场景 |
| Ethereum 钱包 ETH 余额、实时价格及链上资金异常读取 | 主 Guardian 尚未接入；已有真实 Aave 读取仅为独立扩展 |
| 链上信号与结构化证据 | `OnchainSignalState` / `OnchainEvidence` 已冻结并实现 Zod/infer 与测试；尚未接入运行流程，现有调查 evidence 仍为 `string[]`、confidence 固定为 0.88 |
| 持续监控与异常触发调查 | 尚未实现；当前每次请求都运行调查，并创建新的 Mock 场景 |
| 同钱包跨轮重复/并发执行保护 | 尚未实现；Mock 状态内拒绝重复转换不等于持续监控下的保护 |
| Fork 执行适配器 | C 分支已有 Uniswap V2 执行与金额换算代码；钱包关系、链 ID 和集成要求见 D→C 交接，未完成主流程验收 |
| 四人下一阶段开发 | 职责保持 A 读取、B 分析、C 策略/执行、D API/监控/集成；C/D 修改与验收清单见 [D2C-handoff.md](D2C-handoff.md) |
| 团队共同代码基线 | 团队以 `main` 中的 Guardian Mock 骨架和冻结链上合同为共同基线，从同一提交创建各自工作分支 |

现有冻结范围见 [Guardian Mock 设计](docs/loopx/design/2026-10-06-risk-guardian/需求设计文档.md) 与 [A→B 链上合同设计](docs/loopx/design/2026-10-06-onchain-contracts/需求设计文档.md)。两份记录中的“无未决问题”分别指 Mock 架构纠偏和这两个数据合同，不代表真实采集与持续监控已实现。

A/B 已可按冻结合同分别开发采集与分析。后续实现任务仍需明确：

- 第一版信号已确定为 `DEX_SELL_PRESSURE`；在采集任务中配置 DEX/池范围、窗口长度、交易识别和 USD 估值来源，在分析任务中确定异常阈值。
- 按已确认的一次风险事件一次交易规则实现监控；继续确定轮询间隔、市场恢复指标、阈值和有效样本数，链上信号保持独立，不放进 Portfolio。
- 在已确认的本机 Fork 范围内明确哪些读取、信号与调查接真实数据，哪些保留演示输入，并分别标识。
- 为 ABCD 写明输入、输出、文件范围、交付节点和验收标准；开工时从 `main` 的同一提交创建各自的工作分支。

### 已确认的本轮范围（待实现与验收）

**本机 Fork、固定一个测试钱包、持续监控并按策略自动交易，保留 WETH → USDC。** 当前代码用 ETH 符号表示交易用 WETH；原生 ETH 用于 gas。暂不扩展为较低风险币筛选、多阶段转换或主网自动交易。

**同一次风险事件只交易一次，之后继续监控；市场风险恢复后再次超标且满足完整策略条件，才触发下一次。** 一次交易指一次获批减仓 swap，approve、风险检查、回执查询和余额重读不另计次数。已提交但状态未知时查询结果，不自动重发；交易成功但效果验证失败，也不能再次自动卖出。

事件状态和已知交易需要服务端持久记录，刷新页面、程序重启或暂停/恢复不能清除防重复状态。市场恢复必须由约定的市场信号判定，不能把卖出后仓位下降、置信度下降或读取失败当成恢复。具体恢复指标、阈值、连续样本数和轮询间隔由 B/D 确定；交接文档里的示例参数尚未冻结。

详细参数、现有适配器问题、待协调合同和验收清单见 [D → C 交接说明](D2C-handoff.md)。本节是已确认需求，不代表相关代码已经完成。

## 安装与运行

需要 Node.js **22.12.0 或更新版本**、pnpm **11**；仓库固定 pnpm 11.7.0。

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，输入任意 trim 后非空的测试 wallet，点击 **Run Demo**。核心 Demo 明确显示 **MOCK MODE**，不需要 RPC、真实 API Key、私钥或钱包连接。`MOCK_MODE` 默认 `true`；设置为 `false` 会明确拒绝运行，没有隐藏的真实交易实现。

检查命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

构建后可用 `pnpm start` 运行生产服务。`.env*` 已被 Git 忽略，仅 `.env.example` 可提交；不提交真实私钥或 API Key。

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

外部世界目前由 Mock Adapter 模拟。Orchestrator 管流程，服务通过 Zod 数据合同通信。Risk Engine 做确定性计算；Agent 解释事件、原因、证据与不确定性，没有 Executor 引用。Policy 使用服务端用户预设阈值和资产名单，Agent 建议或文字不构成批准。Executor 只接结构化 `PolicyDecision`，并独立检查可信名单、方向和限额。

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

每个请求有独立 `MockScenarioState`，因此连续点击和并发请求均从初始状态开始。相同状态重复执行会报错，不重试、不回退，不自动反向交易。

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
    risk/                 # 确定性风险和压力测试
    investigation/        # 调查接口、服务、Mock Agent
    policy/               # 用户预设硬规则、资产白名单
    execution/            # 结构化单向减风险执行
    rescue/               # 编排与重读
  mocks/scenarios.ts      # 请求级模拟外部世界
  integration/rescue.ts   # 核心 Adapter 装配入口
  extensions/aave/        # 可选的独立真实只读扩展
  app/
    api/rescue/           # 核心 Mock API
    api/position/         # Aave 扩展 API
    position/             # Aave 扩展只读页面
    page.tsx              # Guardian Mock Dashboard
tests/
```

| 开发者 | 主要目录 | 下一步职责 |
| --- | --- | --- |
| A | `src/modules/portfolio/`、`src/modules/market/` | 钱包余额、行情及链上资金数据；与 D 统一 Fork WETH/USDC 余额和报价口径；按冻结的 `OnchainSignalState` 输出独立信号，不与 Portfolio 混用 |
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

完整字段、校验规则、证据抽样口径和可解析 JSON 示例见 [链上合同](docs/contracts.md)。格式校验不证明链上事实，A 负责真实来源，B 负责证据对结论的支持程度。本次没有修改现有 Investigation 签名、`string[]` 证据、RescueSession 或 API；接入运行流程属于后续集成任务。

```http
POST /api/rescue
Content-Type: application/json

{"wallet":"test-wallet"}
```

HTTP 200 直接返回新 `RescueSession`：before、market、riskAnalysis、policyDecision、execution、可选 after、必填 verification，带 `X-Rescue-Mode: MOCK` 和 `Cache-Control: no-store`。400 / 500 使用 `application/problem+json`，不暴露原始异常。请求不能指定动作、白名单、阈值、RPC 或执行权限。

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

**核心外部能力均为 Mock：** 钱包资产余额、行情冲击和历史变化、Agent 解释与 confidence、ETH → USDC 执行、执行后余额及假 txHash。没有真实 DEX、钱包签名、LLM、交易广播、数据库或多链。

**实际运行的工程能力：** Zod/TypeScript 合同、确定性评分和压力测试、Policy 硬门控、Executor 名单/方向/限额检查、流程编排、独立重读、效果验证、API/UI 与测试。**独立扩展中的实际链上能力：** Aave 只读查询；它不代表主 Guardian 已能执行真实防御交易。

OpenAPI 文档验证范围为 JSON 解析、内部引用及示例对 Zod 合同的检查；仓库没有专门 OpenAPI 规范校验器，未声称完成完整 OpenAPI 规范验证。

## 验收标准

- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- [ ] 两个链上合同可从公共入口导入；测试验证三类证据必填引用、零基线拒绝、ratio 一致性、UTC 窗口、计数关系及未知字段拒绝。
- [ ] 无真实 Key/RPC 时启动核心页面，明确显示 MOCK MODE。
- [ ] Run Demo 展示 10 ETH / $30,000 / 100% → 模拟 $3,000 → $2,700 → Risk 91 / Confidence 88% → Policy Triggered → Mock 3 ETH → 8,100 USDC → 独立重读 7 ETH / 8,100 USDC / 70% → PASSED。
- [ ] 页面解释 $3,000 价值变化来自市场冲击，压力测试基于 before 快照。
- [ ] Policy 条件不满足或等于阈值时，Executor 调用次数为 0。
- [ ] Executor 拒绝未批准、自由文本、反向、陌生资产、非白名单及超限决定；Agent 无法绕过 Policy。
- [ ] 测试覆盖 80% 降低 30 个百分点 → 50%，不是出售风险资产的 30%。
- [ ] 成功执行后确实再读 Portfolio；执行失败无 after，未改善或余额证据不符为 FAILED 并停止，重读失败明确报错。
- [ ] 多次/并发请求隔离，没有自动重新入场、追加交易或真 txHash。
- [ ] `/api/rescue` 严格输入与新 DTO/verification/error 合同一致；旧借贷格式不继续输出。
- [ ] Aave 的 3 个专项测试保持通过；现有读取路径/字段/错误/NO_DEBT/canonical 要求不变，主核心不依赖它。

本轮 Fork 自动监控的新增验收项（尚未完成）：

- [ ] 固定测试钱包、签名地址、Fork 链配置和 WETH/USDC 读取一致，配置保存后按约定生效。
- [ ] 服务端持续监控，在完整策略满足时自动执行；同一事件持续超标不重复 swap。
- [ ] 只有市场风险满足恢复条件后再次超标，才建立新事件；减仓、数据缺失、重启和暂停/恢复不绕过去重。
- [ ] 交易待确认时不重新广播 swap，执行后独立重读并如实展示 PASSED/FAILED；明确失败和验证失败的处理符合交接约定。
- [ ] 页面正确区分 Mock、Fork 交易和演示分析输入；完成监控 → Policy → Fork 执行 → 重读 → 展示的全流程验收。
