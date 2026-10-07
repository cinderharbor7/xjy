---
source: docs/loopx/design/2026-10-06-onchain-contracts/需求设计文档.md
status: ready
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: [P-001]
---

# Onchain 两个合同冻结

## Goal And Boundaries

按用户裁决新增两个Zod/infer合同，固定A→B的卖压数据及证据。保留旧公共签名/HTTP/Mock，不接真实采集、Agent或监控。冻结实施阶段不commit/push，后续发布授权见下方交接记录。四人交接文档需要跨上下文保留，故使用此精简计划。

## P-001 合同与边界测试

新增独立schema，经公共入口导出及infer类型；冻结字段、正基线、有限ratio、窗口、去重计数口径和分类证据。关键边界与示例可解析。

> writes: `src/domain/schemas/onchain.ts, src/domain/schemas/index.ts, src/domain/types/index.ts, tests/onchain-contracts.test.ts, .loopx/intake/2026-10-06-onchain-contracts/, docs/loopx/design/2026-10-06-onchain-contracts/, docs/loopx/plans/2026-10-06-onchain-contracts.md`
> anchors: `AC-001..004, D-001..003, TC-001..004`
> verify: `pnpm exec vitest run tests/onchain-contracts.test.ts; pnpm typecheck`
> review: 三分支必填字段、ratio/时间/计数校验、导出不破坏旧合同

已完成：新增53项合同测试通过，`pnpm typecheck`通过。文档代理直接使用最终schema校验JSON示例通过。

## P-002 交接文档与整体回归

README与contracts说明最终结构、AB责任和未接真实能力。顺序整合独立结果，完整验证及独立审查，没有声明整个真实监控产品已完成。

> writes: `README.md, docs/contracts.md, docs/loopx/plans/2026-10-06-onchain-contracts.md`
> anchors: `AC-005,006, D-004, TC-004,005`
> verify: `pnpm typecheck; pnpm test; pnpm build; git diff --check`
> review: 实际diff与文档一致、旧API/Mock/权限不变、未扩范围

## Integration And Final Verification

独立审查新数据合同、scoped及全量测试、typecheck/build；新示例可用且README状态准确。原230测试基线已通过。

新鲜结果（2026-10-06）：`pnpm typecheck && pnpm test && pnpm build`退出0；12个测试文件、283项测试全部通过（原230项 + 新53项）。生产构建成功，现有首页、rescue与position路由保留。独立代理审查全部新增及修改文件，无需修复事项；另验证合同/API/Orchestrator共75项通过。文档JSON示例已用最终schema直接校验，`git diff --check`通过。

## Handoff And Residual Risks

- Blockers: 无。
- Residual risks: 格式校验不证明链上事实，真实数据与监控装配尚未实现，后续A/B需核验来源。
- Resume note: 两个slice已完成，schema/type由根编辑，test代理仅写新测试、文档代理仅写contracts，审查代理只读；共享结果顺序整合。合同未接入现有运行流程。冻结阶段工作树保留供审查，发布按后续授权执行。

## 发布交接（2026-10-07）

用户明确授权“你push吧”；发布范围为本轮11个合同、测试与交接记录文件，正常提交并推送origin/main，保留现有历史。README共同基线说明随发布更新，实际成功状态以执行后的远端ref与本地HEAD核对为准。

发布前再次运行`pnpm typecheck && pnpm test && pnpm build`，退出0，12个测试文件、283项测试通过，生产构建成功；再次独立只读核对提交范围与内容，未发现敏感信息或范围外改动，不读取环境文件。
