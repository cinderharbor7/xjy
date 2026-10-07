# Autonomous On-chain Risk Guardian 需求合同

来源：用户附件“最小破坏式架构纠偏”、审计后的开始授权和同目录clarification.md。

## 目标、范围与非目标

保留 TypeScript/Next App Router/pnpm/Zod 模块化单仓库，用一次 Mock 流程证明有限自动减风险：Portfolio+Market→Risk→Investigation→Policy→SWAP_TO_SAFE→重读Portfolio→验证敞口。四人边界仍为A数据、B风险调查、C策略执行、D页面集成。真实Aave读取隔离并保留已有行为，不为它继续开发。禁止真实钱包、DEX、LLM、交易、多链、保险、数据库、队列、重新入场和投资优化；不大改UI。

## Acceptance Criteria

- AC-001：核心合同包含AssetBalance、PortfolioState、独立MarketState、新StressTestResult/RiskAnalysis/PolicyConfig/PolicyDecision/ExecutionResult/RescueSession；Zod与infer type一致，核心无强制Aave/debt/HF/REPAY。
- AC-002：Risk为确定性Demo规则，Agent只输出解释、证据、不确定性与confidence。Policy严格riskScore>80、confidence>0.85、riskExposurePct>70；用户白名单及减风险上限限制动作。
- AC-003：Executor只接结构化PolicyDecision，构造注入可信预设；拒绝未批准、反向、未知/非白名单资产、超限或自由文本。MVP只允许SWAP_TO_SAFE，无自动重新投资。
- AC-004：严格portfolio→market→risk→investigation→policy→execute→portfolio；未批准不调用Executor，执行失败不制造after，成功必须重新读取；验证实际数量变化和敞口降低，失败保留真实数据且不再执行。
- AC-005：Demo初始10ETH@$3000，冲击$2700，Risk91/Confidence0.88，批准30个百分点，Mock3ETH→8100USDC，重读7ETH=$18900/USDC=$8100，敞口100→70。页面明确MOCK MODE及用户批准防御资产。
- AC-006：保留/api/rescue的严格{wallet}入口并整体更换响应；原/api/position、/position及Aave真实只读响应保持。配置缺省Mock无需RPC/key，无真实交易能力。
- AC-007：README说明新定位、前后流、模块、合同、Mock能力、ABCD及验收；pnpm test/typecheck/build通过，浏览器闭环通过，独立审查新数据和权限边界，不提交推送。

## Acceptance Scenarios

| TC | AC | 场景 |
|---|---|---|
| TC-001 | AC-001 | schema拒绝非有限/负值/不一致资产汇总、重复symbol、非法比例、市场字段混入Portfolio |
| TC-002 | AC-002 | 确定性risk/stress计算，阈值等号不触发；Agent文本/建议/夹带权限不能绕过Policy |
| TC-003 | AC-003 | Executor方向、白名单、上限、输入与回执保护；Adapter不能篡改授权 |
| TC-004 | AC-003,005 | 30个百分点的80→50及100→70；重复Mock执行拒绝、并发请求隔离 |
| TC-005 | AC-004,005 | 精确happy path调用顺序、真实重读2次、回执3/8100、after7/8100 |
| TC-006 | AC-004 | Policy不批准零执行；执行/重读失败、钱包错配、敞口不降/回执不符均不能验证成功 |
| TC-007 | AC-005,006 | API与首页Mock闭环无需key；初始/冲击/换币估值区分清楚 |
| TC-008 | AC-001,006 | Aave原精度/证据/NO_DEBT/canonical/RPC错误专项测试保留，双向无core依赖 |
| TC-009 | AC-007 | Fresh typecheck/test/build、浏览器、exact diff独立审查、Git状态 |

未决问题：无。无持久数据迁移，旧API格式与新核心有意不兼容，不维护两个救援产品。

后续发布授权（2026-10-06）：用户已明确要求提交并推送当前新版至 cinderharbor7/xjy。AC-007 中“不提交推送”描述原架构实施阶段，现由该发布授权取代；发布只涉及已验证的 Mock 骨架、已有只读扩展及文档，不改变产品范围或启用真实交易。
