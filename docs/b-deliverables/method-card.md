# B 方法卡：事实 / 解释 / 未知项

> 角色：B（方法与解释）
> 日期：2026-10-07
> 状态：冻结方案交付物，不修改源码
> 基线：main `7d6ceec`

---

## 1. 方法概述

本项目对 Ethereum 异动的调查遵循**三层结构化输出**：

1. **事实（Facts）**：链上可直接读取、有明确出处的数据
2. **解释（Interpretation）**：基于确定性规则对事实的有限推断
3. **未知项（Uncertainties）**：证据不足以支撑的判断，明确标注缺口

**核心原则**：不把规则分数称为预测概率，不把单池证据升格为全市场结论，不把局部 Swap 等同于整笔交易的净方向。

---

## 2. A→B 量化分析链路

### 2.1 输入数据合同

A 输出冻结的 `OnchainSignalState`，B 只消费不修改：

| 字段 | 含义 | 边界 |
|---|---|---|
| `windowStart` / `windowEnd` | UTC 观察窗口 `[start, end)` | 5 分钟等长窗口 |
| `currentSellVolumeUsd` | 当前窗口 gross sell 额 | 不减买入 |
| `baselineSellVolumeUsd` | 紧邻前一等长窗口 gross sell 额 | 必须 > 0 |
| `anomalyRatio` | `current / baseline` 倍数 | 不是百分比 |
| `txCount` | 卖出交易去重计数 | 按 txHash |
| `uniqueWallets` | 原始发起钱包去重计数 | 按 `tx.from`，≤ txCount |
| `evidence` | `OnchainEvidence[]` | TRANSACTION / BLOCK / CONTRACT_EVENT |

### 2.2 风险评分方法

**基础分数**（RiskService，确定性规则）：

```text
riskScore = round(0.5 × volatilityScore
                + 0.3 × clamp(-priceChange1hPct × 10, 0, 100)
                + 0.2 × riskExposurePct)
```

- `volatilityScore`：1h 价格变化代理，不是统计波动率
- 无风险资产时 score 为 0
- 压力测试基于 before 快照，对风险资产部分施加 -5% / -10% / -15%

**卖压 uplift**（OnchainRiskService，冻结规则）：

| anomalyRatio | uplift |
|---|---|
| ≤ 1× | 0 |
| 1× ~ 3× | 线性插值至 30 |
| ≥ 3× | 30（封顶） |

总分封顶 100。当前仅 WETH/USDC 0.05% 单池贡献卖压信号。

### 2.3 Confidence 计算方法

```text
confidence = Number((MAX_CONFIDENCE × (0.6 × coverage + 0.4 × sample)).toFixed(2))
```

- `coverage = min(1, uniqueReferences / 3)`：去重引用覆盖度
- `sample = min(1, txCount / 12)`：交易样本量
- `MAX_CONFIDENCE = 0.9`：永不声称确定性
- 重复引用（同 type/hash/contract）不增加 coverage
- 结果用 `toFixed(2)` 保留两位小数，再转为 number；这是实现中的舍入步骤

**重要**：Confidence 衡量引用覆盖窗口的程度，不是 ETH 必然下跌的概率，也不是链上真实性验证。

---

## 3. 调查输出结构

### 3.1 InvestigationResult 字段

| 字段 | 内容 | 示例 |
|---|---|---|
| `summary` | 观察窗口与倍数 | "ETH DEX gross sell volume is 3.00× the equal-length previous window over 2026-10-06T12:00:00Z–2026-10-06T12:05:00Z." |
| `primaryCause` | 基于倍数的事实描述 | "Elevated ETH gross sell volume on the observed DEX window." / "unchanged" / "lower" |
| `evidence` | 聚合数据 + 逐条引用 | "$300000 gross sells vs $100000 baseline (3.00×) over 12 sell transactions and 8 unique wallets" + 每条 evidence 的 type/hash/block/description/source |
| `uncertainties` | 明确标注的缺口 | 见下方标准未知项 |
| `confidence` | 按上述规则计算 | 0.00 ~ 0.90 |

### 3.2 标准未知项（自动包含）

每次调查输出固定包含以下未知项：

1. **Gross ETH sell volume does not net buys and does not by itself establish a directional price move.**
   - 统计的是总卖出额，不减去买入，不能直接推出价格方向

2. **evidence.length samples the window; it is not txCount and cannot be extrapolated to uniqueWallets.**
   - 抽样证据数量不等于交易总数，不能外推

3. **The frozen schema validates reference format and internal consistency, not that the transactions exist.**
   - Schema 校验格式，不独立验证链上真实性

4. **Confidence measures how well the supplied references cover the window, not the probability that ETH keeps falling.**
   - Confidence 是引用覆盖度，不是下跌概率

### 3.3 交易核验输出结构

`TransactionCheckReport` 同样遵循事实/解释/未知项：

| 分类 | 说明 |
|---|---|
| `confirmedFacts` | 可确认事实：外层交易 from/to/value/block/timestamp、本池 Swap 方向与精确数量 |
| `classification` | `NO_SUPPORTED_SWAP` / `SUPPORTED_POOL_SELL` / `SUPPORTED_POOL_BUY` / `SUPPORTED_POOL_MIXED` / `REVERTED` |
| `headline` | 中文概括，如“已核验交易，当前范围没有可确认的兑换证据”或“本池日志确认存在 WETH 换 USDC 的兑换” |
| `summary` | 完整中文解释，含已确认和未确认部分 |
| `uncertainties` | 标准未知项：未核验身份、未读取 trace、单池不覆盖全链、USDC 数量不等于美元等 |

---

## 4. 方法边界

| 能力 | 范围 | 非目标 |
|---|---|---|
| 资产覆盖 | 原生 ETH + USDC 钱包余额 | WETH（Fork 实验除外）、其他代币 |
| 行情来源 | Chainlink oracle 当前/历史 | 非预言机价格、预测价格 |
| 卖压池 | Uniswap V3 WETH/USDC 0.05% 单池 | 其他 DEX、其他池、CEX 账内 |
| 调查深度 | 外层交易 + 固定池 Swap 事件 | 内部 trace、后续路径、身份鉴定 |
| 输出形式 | 结构化报告，不调用 Policy/Executor | 不构成执行授权 |
| AI 参与 | **无真实 LLM**，规则生成解释 | 本轮未接入模型 |

---

## 5. 案例应用模板

### 案例 X：【交易哈希】

**输入**：txHash = `0x...`

**事实**：
- 外层交易：from `0x...`，to `0x...`，value `X ETH`，状态 Success，区块 `N`，时间 `YYYY-MM-DD HH:MM:SS UTC`
- 本池事件：【有/无】Swap，方向【SELL_ETH/BUY_ETH/MIXED】，WETH `X`，USDC `Y`

**解释**：
- 按实际非零事件逐项填写：`SELL_ETH` 为 WETH→USDC，`BUY_ETH` 为 USDC→WETH；MIXED 同时列出两个方向，不合并成发送方净方向
- 未发现支持池的非零 Swap 时，只说明本次覆盖范围没有对应证据；回滚交易只记录尝试金额，不称为成功转账/兑换
- 外层 value 与本池事件分别记录；不能用外层金额替代兑换数量，也不能推测两者差额用途

**未知项**：
- 不能确定整笔交易的净买卖方向（外层转账 vs 池内 Swap 可能服务于不同目的）
- 不能确定地址身份或交易动机
- 单池证据不能代表全链活动
- USDC 数量是代币精确数量，不直接等于美元估值

**来源**：
- Ethereum 主网 RPC 直接读取
- Etherscan 引用链接

---

*本方法卡基于冻结的 `OnchainSignalStateSchema`、`RiskAnalysisSchema`、`InvestigationResultSchema` 和 `TransactionCheckReportSchema`，不修改合同字段或校验规则。*
