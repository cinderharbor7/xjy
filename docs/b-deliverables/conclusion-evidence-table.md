# B 逐条结论—证据核对表

> 角色：B（方法与解释）
> 日期：2026-10-07
> 状态：冻结方案交付物，不修改源码
> 基线：main `086b8e6`
> 对应：P-003「可复查解释」、README TODO「可复查解释」

---

## 使用说明

本表逐项核对 A→B 分析链路中的每一条输出结论，明确标注：

- **事实（Fact）**：链上可直接读取、有明确出处的数据
- **推断（Inference）**：基于确定性规则对事实的有限加工
- **未知项（Unknown）**：证据不足以支撑的判断
- **引用（Reference）**：结论对应的真实数据来源
- **校准状态（Calibration）**：该结论是否经过外部验证，还是未校准规则

**核心原则**：不把规则分数称为预测概率，不把单池证据升格为全市场结论。

---

## 1. 真实窗口案例核对（A 实测，北京时间 2026-10-07 16:49）

数据来源：[`docs/demo-cases.md`](../demo-cases.md) 第 2 节；完整 JSON 见 [`evidence/2026-10-07-a/onchain-analysis.json`](../evidence/2026-10-07-a/onchain-analysis.json)。

### 1.1 观察窗口事实

| # | 输出结论 | 分类 | 事实依据 | 引用 | 校准状态 |
|---|---|---|---|---|---|
| 1.1.1 | 锚点区块 26139420，时间 2026-10-07T08:49:35.000Z | 事实 | Ethereum 主网 RPC `eth_getBlockByNumber` 返回的 `number` 与 `timestamp` | 区块 hash `0x26f371...`；[`etherscan.io/block/26139420`](https://etherscan.io/block/26139420) | 已读取，未独立节点交叉验证 |
| 1.1.2 | 当前窗口 `[08:44:35Z, 08:49:35Z)`，基线窗口 `[08:39:35Z, 08:44:35Z)` | 事实 | 代码按锚点区块时间倒推两个等长 5 分钟窗口 | 源码 `live-data.ts` 窗口计算逻辑 | 逻辑正确性已由代码审查确认 |
| 1.1.3 | 当前 gross sell USD = 6606.23 | 事实 | V3 池 `Swap` 事件中 本池 token0=USDC、token1=WETH：`amount1 > 0` 表示池收到 WETH，`-amount0` 为池支付的 USDC 成交额按事件区块的 Chainlink USDC/USD 报价换算 | 19 条卖出事件引用，见 JSON `evidence` 数组 | 未与第二个独立节点或全部 raw Swap 日志复核总额 |
| 1.1.4 | 基线 gross sell USD = 255825.18 | 事实 | 同上，前一窗口 | 同上 | 同上 |
| 1.1.5 | anomalyRatio = 0.0258（当前 ÷ 基线） | 推断 | 6606.23 / 255825.18 的算术结果 | 由 1.1.3 和 1.1.4 计算得出；`OnchainSignalStateSchema` 校验该等式 | 数学正确，但依赖 1.1.3/1.1.4 的读取准确性 |
| 1.1.6 | 当前卖出交易 3 笔，原始发起钱包 3 个 | 事实 | 当前窗口内卖出事件的 txHash 和 tx.from 去重计数 | JSON 中 `txCount: 3`, `uniqueWallets: 3` | 未验证 tx.from 是否与实际发起钱包一致（RPC 返回即视为事实） |

### 1.2 行情与 Portfolio 事实

| # | 输出结论 | 分类 | 事实依据 | 引用 | 校准状态 |
|---|---|---|---|---|---|
| 1.2.1 | Chainlink ETH/USD = 2614.62 | 事实 | `AggregatorV3Interface.latestRoundData()` 返回的 `answer` | roundId、区块、timestamp 保留在 Portfolio/Market 的 JSON evidence | 报价更新时间为 08:24:23Z，不等于读取时间；5m 变化因此为 0 |
| 1.2.2 | 示例钱包持有 ETH 5.7535、USDC 37.1921 | 事实 | `eth_getBalance` + `balanceOf` 读取，按上述 Chainlink 报价估值 | 钱包 `0xd8dA...` 的区块 26139420 状态 | 只覆盖原生 ETH 和 USDC，不含 WETH 或其他代币 |
| 1.2.3 | Portfolio 合计 USD 15080.46，风险敞口约 99.7534% | 推断 | ETH 归为 RISK，USDC 归为 DEFENSIVE，按分类加总 | 源码 `PortfolioStateSchema` 校验逻辑 | 分类规则是产品设计，非链上固有属性 |

### 1.3 B 规则输出（需明确标注为未校准）

| # | 输出结论 | 分类 | 事实依据 | 引用 | 校准状态 |
|---|---|---|---|---|---|
| 1.3.1 | Risk Score = 21 | 推断 | `round(0.5 × 1.17 + 0.3 × 1.17 + 0.2 × 100)` = 21 | `sell-pressure.ts` + `risk.service.ts` 公式 | **未校准启发式**，不是预测模型；volatilityScore 是 1h 变化代理，不是统计波动率 |
| 1.3.2 | 卖压 uplift = 0 | 推断 | anomalyRatio = 0.0258 ≤ 1，规则规定 uplift = 0 | `sell-pressure.ts` | **未校准规则**；仅 WETH/USDC 0.05% 单池贡献 |
| 1.3.3 | Confidence = 0.63 | 推断 | `0.9 × (0.6 × 13/3 + 0.4 × 3/12)`，去重引用 13 个，txCount = 3 | `onchain-investigation.adapter.ts` | **未校准启发式**；衡量引用覆盖度，不是下跌概率 |
| 1.3.4 | recommendedAction = "NONE" | 推断 | Risk Score 21 ≤ 80，规则规定 NONE | `OnchainRiskService.analyze()` | 基于未校准分数的动作建议 |
| 1.3.5 | "ETH gross sell volume is lower than the preceding equal-length DEX window" | 推断 | anomalyRatio < 1 时的规则生成描述 | `OnchainSellPressureInvestigationAdapter.investigate()` | 是规则模板输出，不是 LLM 理解 |

### 1.4 未知项（自动包含，证据不支持）

| # | 未知项内容 | 为何证据不足 |
|---|---|---|
| U1 | Gross ETH sell volume does not net buys and does not by itself establish a directional price move. | 只统计 WETH 卖出额，不减去买入；无法推出净方向或价格因果 |
| U2 | evidence.length samples the window; it is not txCount and cannot be extrapolated to uniqueWallets. | 19 条引用 ≠ 3 笔交易；抽样方法不保证代表性 |
| U3 | The frozen schema validates reference format and internal consistency, not that the transactions exist. | Schema 只校验格式和数值一致性，不独立验证链上存在性 |
| U4 | Confidence measures how well the supplied references cover the window, not the probability that ETH keeps falling. | 0.63 是引用覆盖度评分，不是统计学置信度或价格预测 |
| U5 | 单池证据不能代表全链活动 | 只覆盖 Uniswap V3 WETH/USDC 0.05%，不含其他 DEX、CEX 或 OTC |
| U6 | 当前窗口未出现异常 | 0.0258× 是正常偏低，不能据此推断 ETH 安全或未来走势 |

---

## 2. 交易核验案例核对（独立 `/investigate` 入口）

数据来源：[`docs/demo-cases.md`](../demo-cases.md) 第 3 节；[`docs/transaction-check.md`](../transaction-check.md)。

### 2.1 主案例 1：大额外层转账 `0x19b457...`

| # | 输出结论 | 分类 | 事实依据 | 引用 | 校准状态 |
|---|---|---|---|---|---|
| 2.1.1 | 交易成功，区块 20449709，时间 2024-08-03T18:08:23Z | 事实 | RPC `eth_getTransactionReceipt` 返回的 `status=1`、`blockNumber`、`blockHash` | [`etherscan.io/tx/0x19b457...`](https://etherscan.io/tx/0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a) | 已读取 |
| 2.1.2 | 外层 value = 20059.2 ETH，input = `0x` | 事实 | RPC `eth_getTransactionByHash` 返回的 `value` 和 `input` | 同上 | 已读取 |
| 2.1.3 | 回执日志 0 条 | 事实 | Receipt `logs.length = 0` | 同上 | 已读取 |
| 2.1.4 | 分类 `NO_SUPPORTED_SWAP` | 推断 | 指定池（V3 WETH/USDC 0.05%）内未发现该 txHash 的非零 Swap 事件 | 交易日志为空；[`etherscan.io/tx/...#eventlog`](https://etherscan.io/tx/0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a#eventlog) | 只检查了单池，不能证明全链无 Swap |
| 2.1.5 | "已核验交易，当前范围没有可确认的兑换证据" | 推断 | 分类为 `NO_SUPPORTED_SWAP` 时的规则生成中文 | `transaction-check.service.ts` | 规则模板输出 |

**未知项**：
- 不能确定地址身份或交易动机
- 单池未发现 Swap 不证明全链未卖出
- 外层 20059.2 ETH 不等于任何兑换数量

### 2.2 主案例 2：本池卖出 `0x310948...`

| # | 输出结论 | 分类 | 事实依据 | 引用 | 校准状态 |
|---|---|---|---|---|---|
| 2.2.1 | 交易成功，区块 26138703，时间 2026-10-07T06:25:23Z | 事实 | Receipt `status=1` 等 | [`etherscan.io/tx/0x310948...`](https://etherscan.io/tx/0x310948594828e864aff5f1bc133968b80889379ec66091e734a6758bf8abc9e9) | 已读取 |
| 2.2.2 | 外层 value = 0.2 ETH | 事实 | `eth_getTransactionByHash` | 同上 | 已读取 |
| 2.2.3 | 本池 logIndex=12：0.198 WETH → 517.590594 USDC | 事实 | V3 池 `Swap` 事件解码：`amount0 = -0.198...` WETH，`amount1 = 517.590594` USDC | [`etherscan.io/tx/...#eventlog`](https://etherscan.io/tx/0x310948594828e864aff5f1bc133968b80889379ec66091e734a6758bf8abc9e9#eventlog) | 已读取；WETH 为负表示流出池子（卖出） |
| 2.2.4 | 分类 `SUPPORTED_POOL_SELL` | 推断 | 发现至少一个非零 WETH→USDC Swap 事件 | 由 2.2.3 推出 | 仅说明本池有卖出事件 |
| 2.2.5 | "本池日志确认存在 WETH 换 USDC 的兑换" | 推断 | 分类为 `SUPPORTED_POOL_SELL` 时的规则生成中文 | `transaction-check.service.ts` | 规则模板输出 |

**未知项**：
- 外层 0.2 ETH 与本池 0.198 WETH 分别记录，不推测差额
- 单池卖出不证明整笔交易/钱包的净卖出方向
- 不能确定地址身份或动机
- USDC 数量是代币精确数量，不直接等于美元估值

---

## 3. 关键结论的校准状态总览

| 结论类型 | 数量 | 已校准 / 未校准 | 说明 |
|---|---|---|---|
| 链上直接读取（区块、交易、日志事件） | 12 条 | 已读取，部分未交叉验证 | 依赖 RPC 返回的真实性 |
| 算术计算（ratio、加总、去重计数） | 4 条 | 数学正确，依赖输入准确性 | 可由第三方复算 |
| 规则评分（Risk Score、Confidence、uplift） | 5 条 | **全部未校准** | 是确定性启发式，不是预测模型 |
| 规则模板中文描述 | 4 条 | **无 LLM，无语义理解** | 是条件分支生成的固定句式 |
| 未知项 | 6 条 | 证据不支持，已明确标注 | 不删除、不缩减 |

**诚实声明**：
- 当前 Risk Score 和 Confidence 没有经过历史回测校准，不能当作 ETH 未来价格下跌的概率。
- 当前调查输出由规则模板生成，没有真实 LLM/Agent 参与；LLM 可能覆盖范围更广，但项目工具在支持范围内提供结构化出处。
- 单池范围（WETH/USDC 0.05%）小于全市场；不能把局部发现升格为全网结论。

---

*本核对表基于冻结的 `OnchainSignalStateSchema`、`RiskAnalysisSchema`、`InvestigationResultSchema` 和 `TransactionCheckReportSchema`，不修改合同字段或校验规则。与源码对应关系见 README 索引。*
