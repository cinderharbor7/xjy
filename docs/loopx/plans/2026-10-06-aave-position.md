---
source: docs/loopx/design/2026-10-06-aave-position/需求设计文档.md
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

# Aave 真实仓位第一里程碑

> 历史里程碑：本文件保留当时的决策和验收记录。当前 Guardian 核心已改为 Portfolio / Market / SWAP_TO_SAFE；有效 Aave 读取仅作为独立可选扩展。当前设计见 [Guardian 设计](../design/2026-10-06-risk-guardian/需求设计文档.md)。

## Goal And Boundaries

在 feat/aave-position 上实现真实只读仓位和独立页面，保留 camelCase 和原 Mock 救援；NO_DEBT 不制造 PositionState。支持 Ethereum 主网 Aave V3 Core 与7200区块行情窗口。只做已授权读取，无交易、LLM或基础设施扩展。本轮不commit/push/merge。

## P-001 查询契约与依赖

建立新增 strict snapshot/error schema 与 infer 类型，冻结 ACTIVE/NO_DEBT 语义。安装固定版本 viem 和官方地址包，已有 schema 无修改。

> writes: `src/domain/schemas/position-read.ts, src/domain/types/position-read.ts, tests/position-read-schemas.test.ts, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .loopx/intake/, docs/loopx/design/, docs/loopx/plans/`
> anchors: `D-001, D-003, AC-001, TC-002`
> verify: `pnpm typecheck; pnpm test tests/position-read-schemas.test.ts`

## P-002 Aave 只读 Adapter

Position 新目录文件完成真实精度、固定区块、价格和行情读取，不碰其他业务模块。借款为空时返回明确状态，getPosition 对不能生成快照的情况抛出明确错误。使用真实 Borrow 证据验证测试钱包。

> writes: `src/modules/position/aave-position.adapter.ts, src/modules/position/aave-contracts.ts, src/modules/position/position-read.error.ts, tests/aave-position.test.ts`
> anchors: `D-002, D-004, AC-003,004,005,006,008,010, TC-001,002,003`
> verify: `pnpm test tests/aave-position.test.ts; pnpm typecheck`
> review: 精度、区块一致性、NO_DEBT、只读权限与历史失败边界

## P-003 独立真实查询 UI

新增 /position 页面只使用查询契约与 API，展示真实仓位、NO_DEBT、行情实际窗口、地址/区块证据和错误。保留用户任意地址输入与公开测试钱包。

> writes: `src/app/position/page.tsx`
> anchors: `D-003, D-004, AC-007, TC-004`
> verify: `pnpm typecheck`；浏览器整体验收在 P-004

## P-004 API、装配与现场交接

新增独立 API/装配；补足配置与README、冻结契约说明、测试钱包证据。验证真实展示及原Demo，独立审查 exact diff，无密钥提交。

> writes: `src/integration/position.ts, src/app/api/position/route.ts, src/app/position/layout.tsx, src/app/page.tsx, tests/position-api.test.ts, .env.example, README.md, docs/contracts.md, docs/aave-position.md, docs/position-api.openapi.json, docs/loopx/plans/, .env.local（ignored 本地公开RPC配置）`
> anchors: `D-001,002,003,004, AC-001,002,003,004,005,006,007,008,009,010, TC-001,002,003,004,005`
> verify: `pnpm typecheck; pnpm test; pnpm build; live POST /api/position; 浏览器输入实际钱包并查询`
> review: exact diff、公有契约不变、只读边界、RPC失败和模式标识

## Integration And Final Verification

- 旧79测试保留，新增契约/Adapter/API边界通过；类型和构建成功。
- 已有Borrow证明地址确有借款，实时查询返回真实区块数据；无借款显示明确结果。
- 保留Mock Run Demo完整流程；没有真实执行或假txHash；分支正确且没有自动提交推送。

2026-10-06 最终新鲜证据：`pnpm typecheck` exit 0；`pnpm test` 9 files / 148 tests passed；`pnpm build` exit 0，生成 `/position` 与两个 API。OpenAPI JSON 解析和22个内部引用检查通过，先前全部示例经过 Zod 校验；未运行独立 OpenAPI 规范校验器。

现场验收：真实 RPC 当前与7200区块前的 EIP-1898 canonical hash 查询通过；实际 API / 浏览器返回 ACTIVE（区块26133805，UTC 14:03:23，抵押3582.92267621、债务1092.89358036、HF2.6100121968080328、ETH2718.59）。无借款地址返回200/NO_DEBT/position=null，非法地址400；原Mock API保持1.08→1.34/$20,000。

独立 exact diff 审查发现区块高度在重组时可能与证据 hash 不一致，已改所有合约查询绑定 blockHash + requireCanonical:true。复审确认修复，新增两个非 canonical 拒绝测试通过，RPC 必要能力同步到配置文档。浏览器现场一次公共RPC失败显示明确错误；验收时手动重新发起独立查询成功，应用没有自动重试或fallback。

## Handoff And Residual Risks

- Blockers: 无。
- Residual risks: 公开RPC可能限流或不支持历史窗口，配置必须支持所需只读；测试钱包可能随后还款，不能保证永远有借款。
- Resume note: 按切片状态恢复，子代理不派生helpers，不重叠写文件；API不得调用Rescue。
