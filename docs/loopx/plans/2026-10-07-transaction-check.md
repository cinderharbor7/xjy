---
source: docs/loopx/design/2026-10-07-transaction-check/需求设计文档.md
status: ready
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: [P-001]
  - id: P-003
    status: done
    depends: [P-001]
  - id: P-004
    status: done
    depends: [P-002, P-003]
---

# Ethereum 交易核验 MVP

## Goal And Boundaries

完成独立只读核验入口，用真实交易和限定池事件解释事实与未知。保留 Guardian 公共合同、数据和执行行为，不做新的交易、LLM 或持久化。计划保存独立写入范围，支持并行开发和上下文中断恢复。MVP 实施时用户未要求 commit/push/merge；后续用户已明确要求 push/pull，按实际 Git 结果记录。

## P-001 稳定的查询合同

局部 Zod 事实与报告合同保证金额精确、分类与事件一致、查询错误有安全结构。既有冻结合同保持不变。

> writes: `src/domain/schemas/transaction-check.ts`, `tests/transaction-check-contracts.test.ts`
> anchors: `D-001; AC-001/002/003/005/006`
> verify: `pnpm exec vitest run tests/transaction-check-contracts.test.ts`
> review: `新增合同是否允许不一致的分类、伪造模式或错误引用`

## P-002 真实事实读取与有范围的解释

指定 hash 读取主网交易，校验历史区块、回执和固定池元数据，输出中文报告。普通转账不误称卖出，真实兑换方向清楚，坏数据和 RPC 安全失败。

> writes: `src/modules/transaction-check/`, `tests/transaction-check-reader.test.ts`, `tests/transaction-check-service.test.ts`
> anchors: `D-002/003/004; AC-002/003/004/005/006; TC-001/002/003/004/005`
> verify: `pnpm exec vitest run tests/transaction-check-reader.test.ts tests/transaction-check-service.test.ts`
> review: `RPC 安全、事实一致性、日志方向、未知范围`

## P-003 新手能看懂的查询页面

中文交易哈希表单调用新 API，展示真实只读、事实、兑换证据、未知、来源与下一步；旧结果不会混入新查询。保留主应用导航入口。

> writes: `src/app/investigate/`
> anchors: `D-005; AC-001/005/006; TC-001/002`
> verify: `pnpm typecheck; 后续 API 接通后完成浏览器查询和错误验收`

## P-004 可运行集成与验收

新增 HTTP 查询，装配服务器 RPC，记录接口及运行说明。真实转账和卖出事件通过浏览器，所有回归通过；独立审阅并修复重要发现。

> writes: `src/integration/transaction-check.ts`, `src/app/api/transaction-checks/`, `src/app/page.tsx`（导航）, `tests/transaction-check-api.test.ts`, `docs/transaction-check.md`, `docs/transaction-check-api.openapi.json`, `README.md`, `.env.example`, `本计划状态`
> anchors: `D-001–006; AC-001–008; TC-001–006`
> verify: `pnpm typecheck; pnpm test; pnpm build; 真实 HTTP 和浏览器验收`
> review: `精确最终 diff，旧权限无回归，报告不越过证据`

## Integration And Final Verification

根代理顺序整合共享文件。新增接口没有 Guardian runtime/Policy/Executor 依赖。验收中不删除事件状态。记录真实数据来源、覆盖范围、检查结果和跳过项。OpenAPI 做本地 JSON/合同一致性检查；当前仓库没有独立 OpenAPI validator，不宣称已通过专用验证。

## Handoff And Residual Risks

Blockers: none。Residual risks: 单池证据不能代表全链行为或地址身份；无需实时行情即可核验历史交易；商业需求未验证。Resume note: 以 frontmatter 的状态和实际文件/测试恢复，不重新解释产品范围。

## Fresh Evidence

2026-10-07 14:19 baseline `pnpm test`: 769 passed / 2 skipped. P-001 at 14:23: `pnpm exec vitest run tests/transaction-check-contracts.test.ts`: 7 passed.

P-002 at 14:29: reader/service 89 passed, typecheck exit0. P-003 typecheck exit0; P-004 API/contract at 14:29: 35 passed. HTTP/browser checks still pending.

Final verification (2026-10-07): full `pnpm test` at 14:33: 896 passed / 2 skipped; `pnpm typecheck` and post-fix `pnpm build` exit0. Live RPC/HTTP transfer, SELL, BUY and HTTP 400/404 passed. Browser transfer, SELL, invalid format, missing transaction, old-report clearing and homepage navigation passed. Screenshot export timed out; DOM interaction checks recovered in the same browser space, no screenshot proof claimed. Independent exact code diff review found event reference gap; regression failed before fix, fixed without old OnchainEvidence changes, follow-up review passed and 127 feature tests passed. Generated next-env changes were naturally normalized by final build; no manual discard. README and acceptance record updated. At that verification time the branch was uncommitted/unpushed; subsequent publication follows the user's explicit push/pull request. Existing research files preserved.
