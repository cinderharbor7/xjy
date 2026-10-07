# C → D 回复：交接确认与实施说明

依据：`D2C-handoff.md`（main `bc1d504`）与 `c/policy-execution` 分支。本文逐项回应交接文档第 4 节，并列出本轮已修改内容、实测结果和仍需 D/A 接入的部分。

分支基线：`c/policy-execution`
- `2c2db4a`：Fork 执行适配器 + 金额换算 + 测试（D 审阅的版本）
- `30d5bbb`：本轮按 3.1–3.4 的修改（本文对应版本）

## 1. 对第 4 节的逐项回应

### 1.1 guardian 和受保护钱包是不是同一个 —— 同意

已按“固定一个本机 Fork 测试钱包、签名地址 = 受保护地址”实现，并且是**强制**的，不是约定：

- 构造 `ForkExecutionAdapter` 时用私钥推导地址，与 `recipient` 比较；不一致直接抛 `CONFIG_INVALID`，不进入任何签名流程。
- 执行时读回的 `PortfolioState.wallet` 也必须等于 `recipient`，否则拒绝，避免“读甲的钱、花乙的钱”。
- 地址比较按小写规范化（`sameAddress`），不会因大小写误判。
- 当前适配器**不声称**支持 guardian 管理另一个用户钱包；那需要先确定授权执行方案。

### 1.2 配置属于谁、谁能修改、保存在哪里、何时生效 —— 同意 D 的建议

- C 只提供校验入口，不负责存取：`validatePolicyConfig(input, options)`，返回规范化后的配置，失败抛 `PolicyConfigValidationError`（带 `issues: string[]` 平铺列表，便于映射 HTTP 400）。
- 校验复用冻结的 `PolicyConfigSchema`，没有新建第二套字段或单位。
- C 侧不做持久化、不做版本管理，配置读写归 D。
- 每次执行使用构造时注入的**同一份配置快照**：`PolicyService`、`ExecutionService`、`ForkExecutionAdapter` 三者共用同一个对象，执行中途不会换规则。
- 需要 D 明确：持久化载体（JSON 或 SQLite）与生效时机（同意“保存后从下一次执行生效”）。

### 1.3 HTTP 请求和返回长什么样 —— 同意草案，两点补充

同意 `GET /api/policy?wallet=…`、`PUT /api/policy`、`POST /api/rescue` 只收 `{ wallet }` 的方向。补充：

- C 侧不提供 HTTP 路由，但提供校验入口与错误类型，D 只需把 `PolicyConfigValidationError.issues` 映射成 400 响应体。
- `version`（版本）字段的语义由 D 定；C 建议把“版本冲突”放在 D 的存取层判断，C 不参与，避免同一份配置在两个地方各有一套冲突规则。
- 一次性说明：`PUT /api/policy` 保存本身不发交易，C 的代码链路上没有任何“保存即执行”的路径。

### 1.4 ETH 指原生 ETH 还是 WETH —— 同意，需要 A 配合

- 逻辑符号 `ETH` 在链上就是 **WETH 合约**（`0xC02a…6Cc2`），已在代码常量与注释中写明。
- 原生 ETH 只用于支付 gas，**不进入组合**：否则余额减少量 = 卖出量 + gas，独立重读的差额核算必然不通过。
- 需要 A 确认：Fork 读取侧返回的 `assets` 中，符号 `ETH` 的 `amount` 是 **WETH 余额**（不是原生 ETH 余额）；`wallet` 字段必须是被保护钱包地址。

### 1.5 一次执行使用哪份余额与报价 —— 同意目标，实现方式需要 C/D 对齐

问题是真的：先用一个价格批准额度、执行时又读到另一个价格，可能出现“成交了但验证不通过”。

C 的约束和已实现的部分：

- `ExecutionAdapter` 接口只接收 `PolicyDecision`，合同里没有执行上下文，所以适配器只能通过构造时注入的 `deps.getPortfolio` / `deps.getMarketState` 取数据。
- 因此**冻结由 D 在装配时完成**：构造适配器时把本次执行的 before 快照与 market 快照喂给这两个回调（闭包捕获），适配器就会用与批准同一份的数据换算数量。实时读取会让执行与批准错位。
- 执行前仍保留两个真实链上检查：链上可用余额是否足够、DEX 报价与滑点下限是否为正。这两项是“能不能成交”的检查，不替代数据冻结。
- 需要 C/D 明确：冻结的责任方与传递方式（C 建议由 D 在 orchestrator 内捕获并注入，不改公共 schema）。

### 1.6 什么触发交易、连续超标怎么办、超时怎么办 —— 同意，C 侧已提供状态

- 事件去重、事件状态与持久化归 D；C 不建立并行的事件状态机。
- C 侧提供明确执行状态：失败用 `ForkExecutionFailure` 的阶段码（见第 2 节 3.4），成功用 `ExecutionResult.txHash`（交易哈希）。
- **approve（授权）与回执查询不计入减仓次数**：`submissions()` 只记录真实的减仓 swap，授权交易不会出现在里面。
- `pendingSubmissions()` 返回“已广播但回执未知”的条目，供 D 在重启后阻塞同一事件的新交易。注意：这是**内存记录**，持久化由 D 负责；这也正是 D 建议的“保留事件占用、只查回执、不自动重发”。
- 恢复判定（市场风险是否结束）由 B/D 定，C 不参与；减仓导致的组合风险分下降**不能**当作市场恢复依据，这点与 D 一致。

## 2. 本轮已完成的修改（对应交接文档第 3 节）

### 3.1 策略配置服务

新增 `src/modules/policy/policy-config.service.ts`：

- `validatePolicyConfig(input, { executableAssets })`：唯一校验入口，基于冻结的 `PolicyConfigSchema`。
- 规范化：资产符号去空格、转大写（`" eth "` → `"ETH"`）；**不静默去重**，重复或重叠条目必须报错。
- 可执行性检查：传入链上代币表（Fork 下就是 `Object.keys(chainConfig.tokens)`）时，每个白名单条目必须能在该链执行，否则拒绝保存为有效配置。
- `PolicyConfigValidationError.issues`：平铺问题列表，供 HTTP 层映射。

### 3.2 Fork 钱包关系

`src/modules/execution/fork-execution.adapter.ts`：构造时拒绝签名地址 ≠ 受保护地址；执行时拒绝钱包不一致的仓位读取；地址比较忽略大小写。

### 3.3 统一链与代币配置

- 增加常量 `ANVIL_FORK_CHAIN_ID = 1` 并修正注释：`anvil --fork-url <主网 RPC>` **默认继承主网链 ID 1**，只有显式加 `--chain-id N` 时才不同；启动命令、客户端配置、RPC 实际链 ID 必须一致。
- 每次执行前向 RPC 读取实际链 ID，与配置不一致直接拒绝（返回 `CONFIG_INVALID`），在签名之前完成。
- 代币可执行性在**构造时**就校验（白名单条目必须存在于链上代币表），执行时仍保留一次同类检查。
- 私钥只从运行时注入，仓库里没有真实私钥；RPC、私钥、router、factory 都不属于用户策略表单字段。

### 3.4 交易失败与结果未知

引入 `ForkExecutionFailure`，阶段码：

| 阶段码 | 含义 | 是否已广播 |
| --- | --- | --- |
| `CONFIG_INVALID` | 钱包关系、链 ID、白名单或代币配置不能执行 | 否 |
| `PRE_SUBMIT_FAILED` | 授权/报价/余额检查失败 | 否（授权交易可能有 hash，但不算减仓） |
| `SUBMITTED_UNKNOWN` | 换币已广播，回执未能确认 | **是** |
| `SWAP_REVERTED` | 换币已上链但执行回滚 | 是 |
| `RECEIPT_UNVERIFIABLE` | 有回执但不能证明卖出量等于批准量 | 是 |

- 广播后立即记录到 `submissions()`，状态先置 `SUBMITTED_UNKNOWN`，回执确认后更新为 `CONFIRMED` / `REVERTED`。
- 回执超时不再统一当作“失败并丢弃哈希”：错误文本明确写出已知交易哈希与 `SUBMITTED_UNKNOWN`，并写明“不要为该事件发送新的 swap”。
- 代码里**没有任何自动重发路径**。
- 失败结果仍遵守冻结契约：不带交割数量、不带 `txHash` 字段。

### 需要 D 决策的一个公共合同问题

冻结的 `ExecutionResult` 没有“待确认”状态，所以“已广播、回执未知”目前只能写在 `error` 文本里 + 通过 `submissions()` 程序化读取。**C 没有在自己的分支上修改公共 schema**（按团队规则）。若 D 认为需要显式的 `PENDING` 状态或独立字段，请先协调，C 再改。

## 3. 实测结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | 通过 |
| 全量测试 | `pnpm test` | 312 passed / 2 skipped（Fork 集成默认跳过） |
| Fork 集成 | `FORK_RPC_URL=http://127.0.0.1:8545 pnpm vitest run tests/fork-integration.test.ts` | 2 passed；真实 swap 成交，8 项验证全部 `PASSED` |

本轮新增 17 个测试：

- `tests/policy-config.test.ts`（9）：符号规范化、重叠/重复名单、越界阈值、未知字段、链上不可执行代币、错误列表。
- `tests/fork-adapter-guards.test.ts`（8）：签名地址 ≠ 受保护地址被拒、大小写不误判、钱包不一致的仓位读取被拒、链 ID 不一致被拒、不可执行白名单被拒、失败结果无哈希、`SUBMITTED_UNKNOWN` 文案。

说明：`tests/fork-integration.test.ts` 需要本地 anvil fork，未设置 `FORK_RPC_URL` 时跳过，属预期行为。

## 4. 仍需 D / A 完成或确认

D：

1. 在 `src/integration/rescue.ts` 装配 `ForkExecutionAdapter`（构造参数见交接文档 5.2），并注入**本次执行的冻结快照**作为 `deps`。
2. 决定配置与执行记录的持久化方式、配置版本语义、事件去重与进程重启后的恢复。
3. 决定是否需要在公共 `ExecutionResult` 上增加“待确认”状态（C 不擅自修改）。
4. HTTP 合同落地，并把 `PolicyConfigValidationError.issues` 映射为 400 响应。

A：

1. Fork 读取侧返回的 `PortfolioState.wallet` 必须是被保护钱包地址，`ETH` 条目是 WETH 余额。
2. 行情读取需要能提供本次执行的冻结 `MarketState`（或由 D 冻结）。

## 5. C 的已知限制（不写成为已完成能力）

- 适配器只在 **anvil fork** 上验证过；未在测试网或主网运行，未做 gas 估算与重试策略。
- 只支持 Uniswap V2 单跳 `swapExactTokensForTokens`；没有多跳路由、没有多资产、没有分阶段转换。
- `submissions()` 是内存记录，进程重启即丢失（持久化归 D）。
- 只读的反馈来自 D 的独立重读；适配器本身不判断减仓效果，也不判断市场是否恢复。
- 端到端测试使用手工构造的风险分析；HTTP → 风险模块 → orchestrator 的全流程尚未验收。
