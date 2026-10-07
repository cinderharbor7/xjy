# B 交付物索引

> 角色：B（方法与解释）  
> 日期：2026-10-07  
> 基线：main `086b8e6`  
> 新增：conclusion-evidence-table.md、insufficient-evidence-example.md

---

## 交付清单

| 文件                                                                     | 内容                                                      | 对应冲刺计划            |
| ---------------------------------------------------------------------- | ------------------------------------------------------- | ----------------- |
| [method-card.md](./method-card.md)                                     | 分析方法卡：事实/解释/未知项结构、Risk Score 与 Confidence 计算、标准未知项、方法边界 | P-003：可复查的调查演示    |
| [ai-benchmark.md](./ai-benchmark.md)                                   | 两个真实项目输出与待执行对照；原搜索/计时证据未附，不声明优势                         | P-003：通用 AI 对照待验证 |
| [conclusion-evidence-table.md](./conclusion-evidence-table.md)         | 逐条结论—证据核对表：真实窗口与交易核验的每条结论标注事实/推断/未知/引用/校准状态             | P-003：可复查解释       |
| [insufficient-evidence-example.md](./insufficient-evidence-example.md) | 5 个证据不足反例：零引用、低于基线、重复引用、无风险资产、非法输入；证明系统诚实降级             | P-003：可信案例与可复现证据  |

---

## 快速验证

B 的本轮交付包含解释文档与 `AiInvestigationAdapter`、类型出口、配置示例和测试；该 Adapter 尚未接入现有默认规则流程或网页。未配置凭据或调用失败明确报错，不退回规则冒充 AI。验证方式：

1. 阅读 `method-card.md`，确认：
   - 原规则方法边界与冻结方案一致（单池、未校准、无 LLM）；新增显式 AI Adapter 是独立能力，不能将规则验收当成真实模型验收
   - 标准未知项完整（4 条）
   - 与代码实现一致（`sell-pressure.ts`、`onchain-investigation.adapter.ts`）
2. 阅读 `ai-benchmark.md`，确认：
   - 两个案例来自已有验收记录（transaction-check.md）
   - 项目侧引用 A 的完整输出；通用 AI 原始记录和制作＋复核计时仍待补
   - 不把估算、搜索未命中或示意报告写成实测增益；AC-006 未验收
   - Agent 缺口明确披露
3. 阅读 `conclusion-evidence-table.md`，确认：
   - 每条结论有明确分类（事实 / 推断 / 未知）
   - 关键结论（Risk Score、Confidence、uplift）标注为**未校准规则**
   - 真实窗口数据来自 A 的实测 JSON，交易核验来自既有验收记录
   - 不将规则分数称为预测概率，不把单池证据升格为全市场结论
4. 阅读 `insufficient-evidence-example.md`，确认：
   - 5 个反例均来自现有测试（`tests/onchain-analysis.test.ts`），无需新增代码
   - 系统在证据不足时**不编造、不触发误报、不被刷量欺骗**
   - 零引用时 Confidence = 0.36，低于 Policy 阈值

---

## 与源码的对应关系

| 文档章节          | 对应源码                                                         | 验证方式                                            |
| ------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Risk Score 计算 | `src/modules/risk/risk.service.ts`                           | `pnpm test` 中 risk.test.ts                      |
| 卖压 uplift     | `src/modules/risk/sell-pressure.ts`                          | `pnpm test` 中 onchain-analysis.test.ts          |
| Confidence 计算 | `src/modules/investigation/onchain-investigation.adapter.ts` | `pnpm test` 中 onchain-analysis.test.ts          |
| 调查输出          | `src/modules/investigation/onchain-investigation.adapter.ts` | `pnpm test` 中 onchain-analysis.test.ts          |
| 交易核验          | `src/modules/transaction-check/transaction-check.service.ts` | `pnpm test` 中 transaction-check-service.test.ts |
| 结论证据核对        | `src/integration/onchain-analysis.ts` + A 实测 JSON            | 核对表逐条对应 JSON 字段与代码逻辑                            |
| 证据不足反例        | `tests/onchain-analysis.test.ts`                             | 直接运行 `pnpm test` 中的 5 个对应 case                  |



---

本目录由 B 创建，本地集成校正证据口径。D 可引用方法和项目已验证事实；尚未实测的 AI 对照与增益不得进入成果声明。

## AI 接入代码与当前限制

`AiInvestigationAdapter` 实现既有 `InvestigationAdapter`，构造时显式传入 signal 和服务端 apiKey；apiUrl/model 可覆盖，timeoutMs 覆盖请求和响应体。`.env.example` 仅为配置示例，设置变量不会自动启用 AI。通过 `InvestigationService` 注入后才能调用；现有规则流程不变。

模型证据必须逐字来自输入 evidenceCatalog，未知 hash/address/显式 block 引用被拒绝；解释标为未经独立核实的 AI 推断，必填限制始终保留，Confidence 不得高于既有引用覆盖规则上限。引用成员检查不等于事实、因果或语义核验；不提供自主工具调用，不连接 Executor。

测试使用受控 fetch 响应，不调用真实外部模型。运行流程装配、模型服务选择、凭据配置、实际调用、中文质量和通用 AI 比较均尚未验收；不能声明真实自主 Agent 已跑通。无重试或静默规则 fallback。
