# DeFi 杠杆仓位自动风险救援 Agent

> We don’t drive your portfolio. We protect it when things go wrong.

这是一个供 4 名开发者并行工作的 Hackathon 工程骨架。用户自己管理资产；系统读取仓位、分析风险、调查原因、运行压力测试，再由独立的 Policy Engine 决定是否批准还款。MVP 唯一的自动救援动作是 `REPAY`。

当前全部外部能力使用明确命名的 Mock Adapter。页面始终显示 **MOCK MODE**，不会读取真实 Aave、调用 LLM、请求钱包签名或发送链上交易。

## 安装与启动

需要 Node.js **22.12.0 或更新版本**和 pnpm **11**；项目通过 `packageManager` 固定 pnpm 11.7.0。

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，输入测试 wallet，点击 **Run Demo**。Mock 模式接受任意去除首尾空格后非空的字符串，包括页面默认的测试地址；当前不做真实 Ethereum 地址校验。

无需创建环境文件或提供任何 API Key。`MOCK_MODE` 缺省为 `true`；可选配置参考 [.env.example](.env.example)。`MOCK_MODE=false` 会明确报错，因为当前没有真实 Adapter。预留的 `ETHEREUM_RPC_URL`、`AAVE_NETWORK`、`LLM_API_KEY`、`PRIVATE_KEY` 均不参与 Mock 运行。`.env*` 已被 Git 忽略，只有 `.env.example` 可提交；不要在源码、文档或 Git 中写入真实密钥。

检查命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 使用 Vitest。`pnpm build` 验证生产构建；构建后可通过 `pnpm start` 启动。

## 系统数据流与权限

```text
Ethereum / Aave（当前由 Mock 模拟）
  → Position Service → PositionState
  → Risk Engine → 本地风险与压力测试
  → Investigation Agent → InvestigationResult
  → Orchestrator 合成 RiskAnalysis
  → Policy Engine → PolicyDecision
  → Executor → ExecutionResult
  → Ethereum / Aave（当前由 Mock 模拟）
  → Position Service 再次读取 PositionState
  → Dashboard：Before → Risk → Trigger → Rescue → After
```

Orchestrator 负责模块调用顺序。Agent 只提供调查结果与建议，没有 Executor 引用或执行权限。Policy 不调用 LLM；它读取结构化数值并运行用户预设的硬规则。`recommendedAction` 和调查文本不能替代 Policy 批准。Executor 只接受结构化 `PolicyDecision`，拒绝未触发的决定、自由文本和不一致的执行结果。

Policy 不触发时，Orchestrator 跳过 Executor，并返回 `action: "NONE"`、`success: false`、`amountUsd: 0` 的执行记录；这里的 `success: false` 表示 **skipped**。已批准的执行失败则保留 `REPAY` 和批准金额，并且没有 `after`。执行成功后必须再次通过 Position Service 读取仓位，不能采用 Executor 声称的 Health Factor。Dashboard 比较 `after.healthFactor > before.healthFactor` 验证是否改善；如果没有改善，会明确显示。

## 模块与四人分工

```text
src/
  domain/schemas/                 # 冻结的 Zod 数据契约
  domain/types/                   # 从 Zod 推导 TypeScript 类型
  modules/
    position/                     # PositionAdapter、仓位服务、Mock 读取
    risk/                         # 风险评分与压力测试
    investigation/                # 调查接口、服务、Mock Agent
    policy/                       # 独立硬规则审批
    execution/                    # 执行接口、服务、Mock REPAY
    rescue/                       # RescueOrchestrator
  mocks/scenarios.ts              # 固定场景与请求级模拟状态
  integration/                    # Adapter 装配与统一集成入口
  app/
    api/rescue/                   # POST /api/rescue
    page.tsx                      # 只调用 API 的 Demo Dashboard
tests/                            # 契约、模块与集成测试
docs/contracts.md                 # 八项冻结契约与语义
```

| 开发者 | 主要拥有的目录 | 下一步任务 |
| --- | --- | --- |
| A | `src/modules/position/` | 实现真实 Ethereum / Aave 仓位读取，保持 `PositionAdapter` 接口与输出契约 |
| B | `src/modules/risk/`、`src/modules/investigation/` | 实现风险模型与调查 Agent，输出已有契约，不获取执行权限 |
| C | `src/modules/policy/`、`src/modules/execution/` | 完善硬规则与 Aave Repay Adapter，保持结构化审批边界 |
| D | `src/app/`、`src/integration/` | Dashboard、API、Adapter 装配与联调 |

`src/domain/` 是共同冻结边界；`src/modules/rescue/`、`src/mocks/` 和公共配置的变更由集成负责人协调，顺序合并。模块不得依赖其他模块的内部字段。新增 Adapter 尽量只新增各自目录文件；由 D 在 `integration/` 切换装配，减少共享文件冲突。

## 三个核心数据契约

契约唯一真源在 [src/domain/schemas/index.ts](src/domain/schemas/index.ts)，所有类型由 [src/domain/types/index.ts](src/domain/types/index.ts) 的 `z.infer` 推导。

| 核心契约 | 作用与主要字段 |
| --- | --- |
| `PositionState` | 仓位快照：wallet、collateralUsd、debtUsd、healthFactor、ethPrice、timestamp、可选 blockNumber |
| `RiskAnalysis` | 风险结论：riskScore、confidence、healthFactor、stressTests、investigation、recommendedAction |
| `PolicyDecision` | 唯一的结构化审批结果：triggered、action、repayAmountUsd、reasons |

其余五项 `StressTestResult`、`InvestigationResult`、`PolicyConfig`、`ExecutionResult`、`RescueSession`，以及每个字段的范围和一致性约束，见 [完整契约说明](docs/contracts.md)。对象拒绝未知字段。更改公开字段或语义前需要四人明确确认，再一起更新 schema、消费者、测试和文档。

## 固定 Mock 闭环

| 阶段 | 固定 Demo 数据 |
| --- | --- |
| Before | Collateral $200,000；Debt $100,000；HF 1.08；ETH $2,800 |
| Risk + Investigation | Risk Score 91；Confidence 0.88；调查文本和证据明确标记 Mock |
| Stress Tests | ETH -5% → HF 1.03；-10% → 0.97；-15% → 0.92 |
| Policy | HF < 1.15 **且** Risk Score > 80 **且** Confidence > 0.85；有债务且还款上限为正 |
| Execution | 批准后 Mock REPAY $20,000；返回 `0x` 加 64 位十六进制的假交易哈希 |
| After | Position Service 再次读取：Debt $80,000；HF 1.34 |

压力测试使用本地 Demo 公式 `healthFactor × (1 + ethChangePct / 100)`，四舍五入到两位小数，所以 -15% 对应 **0.92**。执行后的 HF **1.34** 来自独立的固定 Mock fixture，不是用该压力公式或还款公式推算的真实链上结果。

Position 与 Execution Mock Adapter 共享同一个**请求级** `MockScenarioState`，模拟执行对外部仓位的影响。该固定 fixture 只支持一笔精确的 $20,000 还款；其他金额或同一状态的重复执行会报错。每次 API 请求都会创建新状态，因此重复点击 Demo 仍从 HF 1.08 开始，不会累计还款，也不会串用其他请求的 wallet。

## API 与集成入口

```http
POST /api/rescue
Content-Type: application/json

{"wallet":"test-wallet"}
```

成功直接返回满足 `RescueSessionSchema` 的 `RescueSession`，并附带 `X-Rescue-Mode: MOCK` 和 `Cache-Control: no-store`。非法 JSON、空 wallet 或不符合请求契约的字段返回 HTTP 400；配置或流程异常返回 HTTP 500。

核心类是 `RescueOrchestrator.runRescueSession(wallet)`。`src/integration/` 提供 `runRescueSession(wallet)` 作为 API 集成入口，以及 `createMockRescueOrchestrator(wallet, policyConfig = DEMO_POLICY_CONFIG)` 供测试和装配使用。页面不直接实例化业务模块。

Risk Service 先输出包含本地风险评分、压力测试和 `Pending investigation` 的 `RiskAnalysis`，其初始 confidence 为 0。Orchestrator 调用 Investigation Service 后，用其调查结果与 confidence 合成最终 `RiskAnalysis`，再提交 Policy。

## 后续替换 Mock Adapter

在各自目录实现同一个接口，通过 `src/integration/` 注入实例即可；业务服务与 Orchestrator 不判断当前是 Mock 还是真实 Adapter。

| 外部边界 | 当前实现 | 未来替换接口 |
| --- | --- | --- |
| 仓位读取 | `MockPositionAdapter` | `PositionAdapter.getPosition(wallet): Promise<PositionState>`，可实现 `AavePositionAdapter` |
| Agent 调查 | `MockInvestigationAdapter` | `InvestigationAdapter.investigate(position, risk): Promise<InvestigationResult>` |
| 还款执行 | `MockExecutionAdapter` | `ExecutionAdapter.repay(decision): Promise<ExecutionResult>`，可实现 `AaveExecutionAdapter` |

Execution Adapter 所需的 wallet 或外部客户端应由集成入口构造时绑定，执行方法仍只接收 PolicyDecision。真实执行完成后也必须由 Position Service 独立重新读取；不能在 ExecutionResult 中增加新的 HF 字段。真实实现还需要单独确定网络、身份、执行权限及地址校验规则；本骨架不提前实现钱包或私钥管理，也没有可切换的真实 Adapter。

## 当前 Mock 与真实代码

**Mock：** 外部仓位与执行后状态、调查内容、confidence 0.88、还款成功和假 txHash。没有链上查询、真实 LLM、签名或广播。

**实际运行的工程代码：** Zod 校验、TypeScript 类型、模块依赖注入、Orchestrator 顺序控制、独立 Policy 硬规则、执行结果检查、再次读取仓位、API、Dashboard 和测试。风险评分与压力公式是实际执行的本地 Demo 规则，但不代表真实金融模型；Policy 参数也只是 Demo 参数。

范围限定为风险救援工程骨架和 `REPAY`。不加入自动投资、加仓、收益优化、数据库、消息队列、微服务、保险、MEV、跨链或预测交易。

## 验收标准

- [ ] 未配置真实 API Key 时，`pnpm install` 和 `pnpm dev` 可以启动；页面明确显示 MOCK MODE。
- [ ] 任意非空测试 wallet 点击 Run Demo，页面按 Before → Risk → Policy → Execution → After 展示。
- [ ] 数值为 HF **1.08** → Risk **91** / Confidence **88%** → Policy **Triggered** → Mock REPAY **$20,000** → Debt **$80,000** / HF **1.34**。
- [ ] 压力测试为 1.03 / 0.97 / 0.92；调查包含摘要、原因、证据和不确定性。
- [ ] Tx Hash 明确标记 Mock，仅显示为文本，没有真实链上浏览器链接；没有钱包签名提示或连接 Ethereum / Aave / LLM 的外部请求。
- [ ] 再次运行 Demo 仍从初始仓位开始；成功流程两次读取 Position，Dashboard 根据读回的值验证 HF 改善。
- [ ] `pnpm test` 通过，包含 schema、风险、硬规则、Orchestrator 成功路径，以及 Policy 不触发时 Executor 调用次数为 **0**。
- [ ] 测试验证 Agent 的建议和文本不能绕过 Policy，阈值等号不触发，未批准执行被拒绝，成功才出现 `after`。
- [ ] `pnpm typecheck` 和 `pnpm build` 通过。
- [ ] 不提交真实密钥；禁用 Mock 模式时明确失败，没有隐含的真实执行实现。
