---
source: "用户在本次会话提供的产品定义、架构约束和十七项搭建要求"
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
    depends: [P-001]
  - id: P-005
    status: done
    depends: [P-002, P-003, P-004]
---

# DeFi 风险救援 Mock 工程骨架

## Goal And Boundaries

交付 Next.js App Router、TypeScript、pnpm、Zod 的模块化单仓库，支持一次 Mock 救援从 HF 1.08、Risk 91、调查、硬规则审批、REPAY $20,000 到重新读取 HF 1.34。四名开发者分别拥有 Position、Risk/Investigation、Policy/Execution、App/Integration 区域。现有目录仅包含空 Git 仓库，没有可运行的基线测试。

严格采用用户提供的八个公共数据契约。Agent 无执行权限；Policy 决定是否执行；Executor 接受结构化 PolicyDecision；执行成功必须重新读取 Position。外部服务仅 Mock，不做真实 Aave、签名、LLM、数据库、队列、微服务、自动投资或额外金融功能。不提交、推送、合并或丢弃 Git 内容。

## P-001 工程工具与冻结契约

建立可安装的项目配置、八个 Zod schema 与推导类型。非法数值、未知动作和自相矛盾的批准结果被拒绝；环境默认 Mock，密钥文件被忽略。

> writes: `package.json, pnpm-lock.yaml, tsconfig.json, next-env.d.ts, vitest.config.ts, .gitignore, .env.example, src/domain/, tests/schemas.test.ts, docs/loopx/plans/`
> anchors: 技术原则、八个数据契约、环境配置、schema validation
> verify: `pnpm install; pnpm typecheck; pnpm test tests/schemas.test.ts`
> review: 独立审查契约和执行权限边界

## P-002 Position、Risk、Investigation 与 Mock 场景

只通过契约读仓位、计算简化风险和压力测试、返回固定 Mock 调查。Mock 状态按单次请求隔离。调查证据明确指出模拟数据与不确定性。

> writes: `src/modules/position/, src/modules/risk/, src/modules/investigation/, src/mocks/, tests/risk.test.ts, tests/position-investigation.test.ts`
> anchors: PositionAdapter、InvestigationAdapter、固定 Demo 场景、开发者 A/B 边界
> verify: `pnpm test tests/risk.test.ts tests/position-investigation.test.ts`

## P-003 Policy 与 Execution 边界

硬规则采用用户要求的严格小于/大于语义，全部满足才批准还款，金额不超过债务和 Demo 上限。执行服务拒绝未批准动作、自由文本、未知动作及不一致金额。Mock 执行共享模拟外部状态，返回格式正确的假交易哈希。

> writes: `src/modules/policy/, src/modules/execution/, tests/policy-execution.test.ts`
> anchors: 仅 REPAY、Agent 不能绕过 Policy、Policy 不依赖 LLM、开发者 C 边界
> verify: `pnpm test tests/policy-execution.test.ts`
> review: 独立审查未批准执行、金额约束与模拟 Adapter 的状态边界

## P-004 开发者 Demo 页面

通过 POST /api/rescue 展示 Before、Risk、Policy、Execution、After；显示 MOCK MODE 和 HF 改善验证。具备输入、加载和错误状态。页面不包含业务决策。

> writes: `src/app/page.tsx, src/app/layout.tsx, src/app/globals.css`
> anchors: 简洁 Dashboard、MOCK MODE、Run Demo、开发者 D 边界
> verify: `pnpm typecheck`；浏览器整体验收在集成切片完成

## P-005 总控、API、集成与交接

Orchestrator 按指定顺序运行，不触发则跳过执行；成功后再次读取 Position，再返回经过 schema 验证的 RescueSession。装配入口在 integration；API 错误明确返回状态码。README 与契约说明给出四人所有权和 Mock 替换方式。

> writes: `src/modules/rescue/, src/integration/, src/app/api/, tests/orchestrator.test.ts, tests/api.test.ts, README.md, docs/contracts.md, docs/loopx/plans/`
> anchors: 严格数据流、POST /api/rescue、关键测试、README 十项要求、完成标准
> verify: `pnpm typecheck; pnpm test; pnpm build; pnpm dev; 浏览器验收`
> review: 独立审查最终 exact diff，重点流程顺序、Agent 无执行能力、重新读取仓位、Mock 标识

## Integration And Final Verification

- 安装、typecheck、全部核心测试、production build 都以新命令输出验收。
- 浏览器与 HTTP 验证固定场景、格式正确交易哈希、重复请求隔离、非法输入拒绝。
- 无触发时 executor 调用次数为零；阈值等号不触发；执行失败无 after；成功必须读取两次。
- 将具体验收标准在跑完整测试前提供给用户。

2026-10-06 验收证据：`pnpm install` 成功；`pnpm typecheck` 通过；`pnpm test` 六个文件、79 个测试通过；`pnpm build` 成功生成 `/` 和 `/api/rescue`；`pnpm dev` 在 localhost:3000 正常启动。HTTP 请求返回 200、MOCK 响应头和合法 RescueSession。浏览器输入 `hackathon-test-wallet` 并实际点击 Run Demo，展示 Risk 91、Confidence 88%、Policy Triggered、Mock REPAY $20,000、Debt $80,000、HF 1.08 → 1.34 与读取后改善验证。

独立 exact-diff 审查覆盖全部新增源码、配置、六个测试文件、README 与契约说明，未发现需要修复的事项；审查者新鲜运行 Policy/Execution、Orchestrator、API 共 47 个测试通过，确认环境密钥文件被忽略。

## Handoff And Residual Risks

- Blockers: 无。
- Residual risks: 风险评分、调查、仓位和执行是 Demo 模拟，没有生产金融正确性或交易权限保证；不得作为真实链上执行实现使用。
- Resume note: 五个切片全部验收完成；后续四人按 README 目录所有权开发，公共契约变更先协调。没有执行 Git commit、push 或 merge。
