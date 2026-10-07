---
source: docs/loopx/design/2026-10-06-risk-guardian/需求设计文档.md
status: ready
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: []
  - id: P-003
    status: done
    depends: [P-002]
  - id: P-004
    status: done
    depends: [P-002]
  - id: P-005
    status: done
    depends: [P-001, P-003, P-004]
  - id: P-006
    status: done
    depends: [P-002]
---

# Guardian 最小架构纠偏

## Goal And Boundaries

保留现有工程/模块门控，核心换成Portfolio+Market与SWAP_TO_SAFE，30为百分点；Mock重读100→70。Aave有效未提交实现搬至扩展并保留读取行为。技术栈/启动不重建，无真实交易、基础设施或re-entry；不commit/push/discard。

## P-001 Aave可选扩展

搬迁局部借贷合同、读取服务和Adapter，旧API/UI只改imports与定位，三个专项测试行为完整保留。新核心和扩展不互相依赖。

> writes: `src/extensions/aave/, src/domain/*/position-read.ts, src/modules/position/{position.adapter.ts,position.service.ts,aave-position.adapter.ts,aave-contracts.ts,position-read.error.ts}, src/integration/position.ts, src/app/api/position/, src/app/position/page.tsx, tests/{aave-position,position-read-schemas,position-api}.test.ts`
> anchors: `D-005, AC-001,006, TC-008`
> verify: `pnpm test tests/aave-position.test.ts tests/position-read-schemas.test.ts tests/position-api.test.ts`
> review: 外部Aave合同与真实只读行为保持

## P-002 核心合同与模拟数据世界

新Zod/type/verification合同和Portfolio/Market服务；每请求Mock世界模拟价格冲击、白名单内单向换币，提供独立读取。共享合同先验证冻结。

> writes: `src/domain/schemas/index.ts, src/domain/types/index.ts, src/domain/verification.ts, src/modules/portfolio/, src/modules/market/, src/modules/position/mock-position.adapter.ts, src/mocks/scenarios.ts, tests/schemas.test.ts, tests/portfolio-market.test.ts`
> anchors: `D-001,003,004, AC-001,003,005, TC-001,004`
> verify: `pnpm test tests/schemas.test.ts tests/portfolio-market.test.ts`

## P-003 风险调查与受限执行

原目录调整输入、Demo计算、Policy与Executor，保留可信门控并补资产方向和百分点上限。风险、调查不持有执行引用；回执匹配批准。

> writes: `src/modules/{risk,investigation,policy,execution}/, tests/{risk,policy-execution,position-investigation}.test.ts`
> anchors: `D-002,003, AC-002,003,005, TC-002,003,004`
> verify: `pnpm test tests/risk.test.ts tests/policy-execution.test.ts tests/position-investigation.test.ts`
> review: Agent权限、可信白名单、反向/超限执行与回执保护

## P-004 Guardian首页

复用原首页样式，仅更换新Session展示；区分市场跌价、Mock换币和效果验证，保留MOCK MODE，不把USDC描述绝对安全。

> writes: `src/app/page.tsx, src/app/layout.tsx`
> anchors: `D-006, AC-005,006, TC-007`
> verify: 新合同静态检查；完整浏览器闭环在集成验证

## P-005 集成、文档与最终审查

更新编排、装配和API，成功后重读并验证真实数量变化和风险敞口；更新README/schema说明/OpenAPI/历史定位和ABCD。所有独立结果逐一读入整合。

> writes: `src/modules/rescue/, src/integration/rescue.ts, src/app/api/rescue/, tests/{orchestrator,api,openapi}.test.ts, .env.example, docs/loopx/design/2026-10-06-risk-guardian/, docs/loopx/plans/2026-10-06-risk-guardian.md, .loopx/intake/2026-10-06-risk-guardian/`
> anchors: `D-001..006, AC-001..007, TC-001..009`
> verify: `pnpm typecheck; pnpm test; pnpm build; 浏览器Run Demo; git diff --stat`
> review: exact diff、合同/权限/效果验证、Aave兼容和未扩需求

## P-006 文档与API合同

新核心合同、前后数据流、ABCD、Mock/真实区分与验收写入README和说明；Aave文档定位可选扩展，旧方案标历史，不改历史决定。OpenAPI记录新响应和旧只读行为。

> writes: `README.md, docs/contracts.md, docs/aave-position.md, docs/*openapi.json, docs/loopx/design/2026-10-06-aave-position/, docs/loopx/plans/2026-10-06-aave-position.md, docs/loopx/plans/2026-10-06-rescue-skeleton.md`
> anchors: `D-001..006, AC-001..007, TC-007,008,009`
> verify: JSON/内部引用/示例检查、对照最终代码；完整交接在最终验证

## Integration And Final Verification

fresh全套检查、Mock API与浏览器100→70、原Aave专项、数据/权限边界独立审查。OpenAPI验证如无专用工具需披露检查范围。结束时给完整验收标准、最终schemas和ABCD交接，Git变更保持未提交。

## Handoff And Residual Risks

- Blockers: 无。
- Residual risks: Demo估值/波动/防御资产价格是简化模型；Aave公共RPC可失败且不降级，不影响主Mock。
- Resume note: 全部切片完成；基线148通过，最终230通过。禁止子代理派生helpers，独占写范围，合同及共享场景由根agent顺序整合。当前改动未提交/推送，保留原Aave有效工作。

## Fresh Final Evidence / 最终验证

- `pnpm typecheck && pnpm test && pnpm build`：2026-10-06 23:20（Asia/Shanghai）exit 0；11 suites / 230 tests通过；Next16.3.8构建通过，保留 `/`, `/api/rescue`, `/position`, `/api/position`。
- 测试包括70项Aave专项；新的Guardian合同、评分、严格阈值、Agent不能越权、反向/未知/未批准/超限拒绝、回执/授权防篡改、80→50百分点、必须独立第二次读取与FAILED诚实输出。
- Independent exact working-tree review发现两项并已修复：全额分数ETH转换浮点负余额，以及OpenAPI reasons字符串约束。前者新增2个回归先红后绿，状态写入前验证新组合；后者新增OpenAPI JSON/ref/示例及约束测试。修复后独立复核未发现剩余问题，复核21项专项通过。
- Browser（ego-browser TaskSpace4）：最终修复后的真实页面Run Demo，wallet=guardian-final-acceptance，10 ETH/$30000/100% → ETH2700 → Risk91/Confidence88% → Policy批准30个百分点 → Mock3ETH/8100USDC → 独立重读7ETH+8100USDC/$27000/70% → PASSED。MOCK MODE、市场跌价解释及初始压力测试基准可见。TaskSpace完成一次，保留最终结果页。
- OpenAPI：两份JSON、39个内部引用、17个示例及字段/必填集合人工脚本检查通过；新增11项持久测试对JSON/ref及核心示例/约束通过。没有完整OpenAPI规范校验器，没有声称其完整规范检查通过。
- `git diff --check` exit 0。分支仍为feat/aave-position，无commit/push/merge/discard。统计包含此前Aave里程碑未提交改动，不代表全部属于本次纠偏；38个未跟踪文件不计入以下git diff --stat。

```text
 .env.example                                       |   9 +-
 README.md                                          | 210 ++++++------
 docs/contracts.md                                  | 283 +++++++++-------
 docs/loopx/plans/2026-10-06-rescue-skeleton.md     |   2 +
 next-env.d.ts                                      |   4 +-
 package.json                                       |   6 +-
 pnpm-lock.yaml                                     | 154 +++++++++
 src/app/api/rescue/route.ts                        |  20 +-
 src/app/layout.tsx                                 |   4 +-
 src/app/page.tsx                                   | 140 ++++++--
 src/domain/schemas/index.ts                        | 150 ++++++---
 src/domain/types/index.ts                          |  12 +-
 src/integration/rescue.ts                          |  19 +-
 src/mocks/scenarios.ts                             | 112 +++++--
 src/modules/execution/execution.adapter.ts         |   2 +-
 src/modules/execution/execution.service.ts         |  28 +-
 src/modules/execution/mock-execution.adapter.ts    |  26 +-
 src/modules/investigation/investigation.adapter.ts |   4 +-
 src/modules/investigation/investigation.service.ts |  15 +-
 .../investigation/mock-investigation.adapter.ts    |  18 +-
 src/modules/policy/policy.service.ts               |  58 ++--
 src/modules/position/mock-position.adapter.ts      |  11 -
 src/modules/position/position.adapter.ts           |   5 -
 src/modules/position/position.service.ts           |  16 -
 src/modules/rescue/rescue.orchestrator.ts          |  48 ++-
 src/modules/risk/risk.service.ts                   |  24 +-
 src/modules/risk/stress-test.ts                    |  22 +-
 tests/api.test.ts                                  |  42 ++-
 tests/orchestrator.test.ts                         | 180 +++++++---
 tests/policy-execution.test.ts                     | 366 ++++++++++++++-------
 tests/position-investigation.test.ts               | 117 +++----
 tests/risk.test.ts                                 |  92 +++---
 tests/schemas.test.ts                              | 119 ++++---
 33 files changed, 1495 insertions(+), 823 deletions(-)
```

验收以README的验收标准为准；所有核心结构与范围以domain Zod唯一真源及docs/contracts.md为准。未接真实DEX/钱包/LLM/交易，没有自动重新入场，也没有新基础设施。

## Subsequent Publication / 后续发布

2026-10-06 用户明确要求推送新版至 cinderharbor7/xjy。此前“保持未提交”“不commit/push”为已结束的架构实施阶段事实，本次允许提交已验证的内容，普通推送更新 main 并同步 feat/aave-position，保留 Git 历史。发布前重新通过 typecheck、230项测试和build，并核对暂存文件不含私钥、本地环境配置或运行产物。该授权不改变尚未冻结的后续真实能力范围；实际提交与远端状态以 Git 为准。
