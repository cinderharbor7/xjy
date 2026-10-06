# 冻结的数据契约

这八项结构是模块间和 API 返回值的数据边界。唯一真源是 [Zod schemas](../src/domain/schemas/index.ts)；[TypeScript types](../src/domain/types/index.ts) 全部使用 `z.infer` 从 schema 推导，不重复维护接口。API 请求另由 `RescueRequestSchema` 校验。

任何公开字段、范围或语义变更，都需要四名开发者确认，并同时修改消费者、测试和文档。各模块只交换这些结构，不读取其他模块内部状态；请求级 Mock 状态仅供 Mock Adapter 模拟外部世界。

## 公共规则

- 所有对象使用 Zod strict object，拒绝未知字段，不会静默丢弃额外字段。
- 数值必须是有限数；USD 金额非负；confidence 在闭区间 `[0, 1]`。
- wallet 去除首尾空格后必须非空。Mock 阶段允许测试标签，不验证 EVM 地址格式。
- timestamp 是 `z.iso.datetime()` 验证的 UTC ISO 8601 时间字符串，示例 `2026-10-06T12:00:00.000Z`。
- action 与 recommendedAction 只能是 `"NONE"` 或 `"REPAY"`。NONE 表示不执行动作。

## PositionState

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| wallet | string | 非空、trim；仓位所属 wallet |
| collateralUsd | number | 有限且 ≥ 0 |
| debtUsd | number | 有限且 ≥ 0 |
| healthFactor | number | 有限且 ≥ 0 |
| ethPrice | number | 有限且 > 0 |
| timestamp | string | UTC ISO 时间；读取仓位的时间 |
| blockNumber | number，可选 | 非负整数；Mock fixture 不提供该字段 |

Position Service 验证 Adapter 输出，并要求返回的 wallet 与请求一致。执行后的 PositionState 只能来自独立的再次读取。

## StressTestResult

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| ethChangePct | number | 有限且 ≥ -100；单位是百分比，如 -5 表示跌 5% |
| projectedHealthFactor | number | 有限且 ≥ 0 |
| liquidationRisk | boolean | 当前 Demo 在有债务且 projectedHealthFactor ≤ 1 时为 true |

当前公式为 `HF × (1 + ethChangePct / 100)`，结果保留两位小数；HF 1.08 在 -5% / -10% / -15% 时为 1.03 / 0.97 / 0.92。它不包含真实 Aave 清算参数。

## InvestigationResult

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| summary | string | 长度至少 1 |
| primaryCause | string | 长度至少 1 |
| evidence | string[] | 可为空 |
| uncertainties | string[] | 可为空 |
| confidence | number | 有限且在 `[0, 1]` |

调查结果只描述风险，不包含授权或执行方法。当前 Mock confidence 固定为 0.88，文本明确说明模拟数据、未调用 LLM 和压力模型限制。

## RiskAnalysis

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| riskScore | number | 有限且在 `[0, 100]` |
| confidence | number | 有限且在 `[0, 1]` |
| healthFactor | number | 有限且 ≥ 0；必须描述 before 仓位 |
| stressTests | StressTestResult[] | 可为空；Demo 有三个场景 |
| investigation | InvestigationResult | 嵌套结构也严格校验 |
| recommendedAction | NONE 或 REPAY | 建议，不能授权执行 |

Risk Service 先生成本地评分与压力测试，调查字段为 `Pending investigation`，confidence 为 0。Orchestrator 调用 Investigation Service 后，合并正式调查结果及其 confidence，再交给 Policy。`RiskAnalysisSchema` 允许初始值 0；流程保证 Policy 使用合成后的结果。

## PolicyConfig

| 字段 | 类型 | 校验与 Demo 默认值 |
| --- | --- | --- |
| maxHealthFactorForTrigger | number | 有限且 > 0；默认 1.15 |
| minRiskScore | number | 有限且在 `[0, 100]`；默认 80 |
| minConfidence | number | 有限且在 `[0, 1]`；默认 0.85 |
| maxRepayUsd | number | 有限且 ≥ 0；默认 20,000 |

Policy 的比较采用**严格** `<` 和 `>`：HF < 上限，Risk Score > 下限，Confidence > 下限。等于阈值时不触发。另外要求 debtUsd > 0 且 maxRepayUsd > 0。全部通过才批准，还款金额为 `min(debtUsd, maxRepayUsd)`。这些参数目前仅用于 Demo。

## PolicyDecision

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| triggered | boolean | 是否由 Policy 批准执行 |
| action | NONE 或 REPAY | 与 triggered 一致 |
| repayAmountUsd | number | 有限且 ≥ 0；还款 USD 金额 |
| reasons | string[] | 至少一个原因 |

Schema 强制一致性：

- `triggered: false` → action 必须为 NONE，repayAmountUsd 必须为 0。
- `triggered: true` → action 必须为 REPAY，repayAmountUsd 必须 > 0。

金额不得超过当前债务或配置上限由 **Policy Service** 保证，因为单个 PolicyDecision 不携带债务与配置。Executor 只接受此结构，不接受自由文本指令。调查文本与 recommendedAction 不参与 Policy 授权判断。

## ExecutionResult

| 字段 | 类型 | 校验与语义 |
| --- | --- | --- |
| success | boolean | REPAY 是否成功；NONE 时固定为 false |
| action | NONE 或 REPAY | 必须与 PolicyDecision 一致 |
| amountUsd | number | 有限且 ≥ 0；必须等于批准金额 |
| txHash | string，可选 | `0x` 加 64 位十六进制；当前是假哈希 |
| timestamp | string | UTC ISO 时间 |
| error | string，可选 | 错误说明；成功时不允许出现 |

一致性规则：

- NONE 表示 **skipped**，必须 `success: false`、amountUsd 0、没有 txHash；不是执行失败。
- REPAY 的 amountUsd 必须 > 0；成功的 REPAY 必须有 txHash。
- success 为 true 时不得有 error。
- Execution Service 校验 action 和 amountUsd 与原始批准决定完全一致；外部 Adapter 不能擅自更换动作或金额。

执行失败保留 REPAY 和批准金额。ExecutionResult 不含 Health Factor，不能作为执行后仓位的来源。

## RescueSession

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| before | PositionState | 首次读取 |
| riskAnalysis | RiskAnalysis | 风险与调查的合成结果 |
| policyDecision | PolicyDecision | 硬规则审批结果 |
| execution | ExecutionResult | 成功、失败或跳过的执行记录 |
| after | PositionState，可选 | 执行成功后的再次读取 |

Schema 强制跨结构一致性：

- execution.action 与 amountUsd 必须分别等于 policyDecision.action 与 repayAmountUsd。
- execution.success 为 true **当且仅当**存在 after；跳过或失败均不能带 after。
- after.wallet 必须等于 before.wallet。
- riskAnalysis.healthFactor 必须等于 before.healthFactor。

Orchestrator 保证成功后调用 Position Service 重新读取。Schema 不强制 `after.healthFactor > before.healthFactor`：成功执行与仓位改善是两个需要分别验证的事实。Dashboard 从返回的两个快照比较 HF，并在未改善时明确显示。

## HTTP 请求边界

`POST /api/rescue` 请求必须是严格对象 `{ wallet: string }`，应用同一个 WalletSchema。缺字段、空白 wallet、错误类型、未知字段或非法 JSON 返回 HTTP 400。成功响应直接是 RescueSession，无额外包装字段。

当前 Mock API 每次请求建立新的 MockScenarioState，并同时注入 Position 和 Execution Mock Adapter。模块公共契约不携带 Mock 内部状态，也不增加额外的 mock 字段；模式由页面标识和 `X-Rescue-Mode: MOCK` 响应头说明。
