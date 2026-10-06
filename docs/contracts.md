# Guardian 核心数据合同

唯一真源是 [Zod schemas](../src/domain/schemas/index.ts)，[TypeScript types](../src/domain/types/index.ts) 使用 `z.infer` 推导。模块仅交换这些结构；Portfolio 不携带行情字段，Market 独立读取。所有对象严格拒绝未知字段。此前核心借贷合同已被替换；Aave 专属合同保留在 [extensions/aave/schemas.ts](../src/extensions/aave/schemas.ts)，不属于下述核心 Domain。

## 公共规则

- wallet 与 symbol trim 后非空；核心 Mock wallet 允许测试标签，不要求真实地址。
- USD / balance 为有限非负数，敞口/动作百分比和风险/波动分数为 `[0,100]`，confidence 为 `[0,1]`；anomalyRatio 是有限非负倍数，没有 100 的上限。
- timestamp 是 UTC ISO 8601；可选 blockNumber 为非负安全整数；tokenAddress 是 `0x` 加 40 位十六进制。
- action 仅 `NONE | SWAP_TO_SAFE`；白名单由服务端提前配置，请求或 Agent 不能提供授权。
- **reduceExposurePct / maxDeRiskPct 单位为风险敞口百分点**。80% 降低 30 个百分点 → 50%。

## 全部核心结构

以下 TypeScript 仅展示结构，运行校验以 Zod 为准。

```ts
type AssetBalance = {
  symbol: string;
  tokenAddress?: string;
  amount: number;
  usdValue: number;
  category: "RISK" | "DEFENSIVE";
};

type PortfolioState = {
  wallet: string;
  totalUsd: number;
  riskAssetUsd: number;
  defensiveAssetUsd: number;
  riskExposurePct: number;
  assets: AssetBalance[];
  timestamp: string;
  blockNumber?: number;
};

type MarketState = {
  asset: string;
  priceUsd: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  volatilityScore: number;
  timestamp: string;
};

type OnchainEvidence =
  | {
      type: "TRANSACTION";
      txHash: string;
      blockHash?: string;
      blockNumber: number;
      contractAddress?: string;
      description: string;
      source: string;
    }
  | {
      type: "BLOCK";
      txHash?: string;
      blockHash: string;
      blockNumber: number;
      contractAddress?: string;
      description: string;
      source: string;
    }
  | {
      type: "CONTRACT_EVENT";
      txHash: string;
      blockHash?: string;
      blockNumber: number;
      contractAddress: string;
      description: string;
      source: string;
    };

type OnchainSignalState = {
  signalType: "DEX_SELL_PRESSURE";
  asset: "ETH";
  windowStart: string;
  windowEnd: string;
  currentSellVolumeUsd: number;
  baselineSellVolumeUsd: number;
  anomalyRatio: number;
  txCount: number;
  uniqueWallets: number;
  evidence: OnchainEvidence[];
};

type StressTestResult = {
  priceChangePct: number;
  projectedPortfolioUsd: number;
  projectedLossUsd: number;
};

type InvestigationResult = {
  summary: string;
  primaryCause: string;
  evidence: string[];
  uncertainties: string[];
  confidence: number;
};

type RiskAnalysis = {
  riskScore: number;
  confidence: number;
  riskExposurePct: number;
  stressTests: StressTestResult[];
  investigation: InvestigationResult;
  recommendedAction: "NONE" | "SWAP_TO_SAFE";
};

type PolicyConfig = {
  minRiskScore: number;
  minConfidence: number;
  minRiskExposurePct: number;
  maxDeRiskPct: number;
  allowedRiskAssets: string[];
  allowedDefensiveAssets: string[];
};

type PolicyDecision = {
  triggered: boolean;
  action: "NONE" | "SWAP_TO_SAFE";
  sourceAsset?: string;
  targetAsset?: string;
  reduceExposurePct?: number;
  reasons: string[];
};

type ExecutionResult = {
  success: boolean;
  action: "NONE" | "SWAP_TO_SAFE";
  sourceAsset?: string;
  targetAsset?: string;
  sourceAmount?: number;
  targetAmount?: number;
  txHash?: string;
  timestamp: string;
  error?: string;
};

type VerificationResult = {
  status: "SKIPPED" | "PASSED" | "FAILED";
  reasons: string[];
};

type RescueSession = {
  before: PortfolioState;
  market: MarketState;
  riskAnalysis: RiskAnalysis;
  policyDecision: PolicyDecision;
  execution: ExecutionResult;
  after?: PortfolioState;
  verification: VerificationResult;
};
```

## 组合与行情一致性

Asset symbol 在一个组合内唯一；RISK / DEFENSIVE 的 usdValue 汇总分别等于 riskAssetUsd / defensiveAssetUsd；两者之和等于 totalUsd。`riskExposurePct = riskAssetUsd / totalUsd × 100`，空组合 totalUsd=0 时敞口定义为 0。amount 为 0 的资产 usdValue 必须为 0。汇总和比例比较采用浮点容差 `1e-9 × max(1, abs(a), abs(b))`。空 assets 合法，不能因为存在字符串 ETH 就自动认定有风险余额。

Market priceUsd > 0，5m / 1h 变化不得低于 -100%，可为正数；volatilityScore 为 0..100。行情不偷偷塞进 Portfolio。压力测试变化同样 ≥ -100%；投影组合价值与损失非负。

Demo 首读 10 ETH × $3,000 = $30,000，随后 Market Mock 把模拟外部 ETH 价格更新为 $2,700，执行和再次读取得到冲击后估值。风险分析中的 riskExposurePct 必须描述 before。压力测试只冲击 before 中 RISK 的 USD 估值，DEFENSIVE 暂固定：`projectedPortfolioUsd = defensiveAssetUsd + riskAssetUsd × (1 + priceChangePct/100)`，`projectedLossUsd = max(0, totalUsd - projectedPortfolioUsd)`。它是场景计算，不是市场收益预测。

## OnchainSignalState / OnchainEvidence：A → B 冻结合同

这两个合同定义在 [onchain.ts](../src/domain/schemas/onchain.ts)，用于交接 Ethereum 链上 ETH 卖出压力信号。MVP 只接受 `signalType=DEX_SELL_PRESSURE`、`asset=ETH`，不能通过自由字符串加入其他信号或资产。OnchainSignalState 与 PortfolioState / MarketState 分开，既不是用户余额，也不是执行授权。

### 信号统计口径

- `windowStart` / `windowEnd` 使用 UTC ISO 8601。当前窗口为 `[windowStart, windowEnd)`，必须有正的持续时间；恰好位于结束时间的交易属于下一个窗口。
- 设窗口长度为 Δ，基线窗口为紧邻之前的 `[windowStart − Δ, windowStart)`，使用与当前窗口相同的统计范围和口径。字段 `baselineSellVolumeUsd` 表示这个完整等长窗口的卖出总额，不能改成历史均值、买卖净额或其他时间长度。
- `currentSellVolumeUsd` / `baselineSellVolumeUsd` 统计 **ETH 总卖出额，不减买入额**，单位为 USD。当前卖出额必须有限且 ≥0；基线必须有限且 >0。基线为 0 时 A 不能生成有效信号，也不能使用 Infinity、替代基线或补造比例。
- `anomalyRatio = currentSellVolumeUsd / baselineSellVolumeUsd`，必须是有限非负数，按浮点容差 `1e-9 × max(1, abs(a), abs(b))` 验证一致；除法得到非有限值时拒绝该信号。比例表示相对卖出量，是否触发调查由另行配置的规则判断。
- `txCount` 按当前窗口中发生 ETH 卖出的交易哈希去重，同一交易出现多个卖出事件仍只计一笔交易。`uniqueWallets` 按这些交易的原始发起地址 `tx.from` 去重，不按 router、池或事件中的中间地址计数。两者均为非负安全整数，`uniqueWallets <= txCount`；`txCount=0` 时当前卖出额必须为 0。
- `evidence` 可以为空或只提供样本引用。`evidence.length` 不等于 `txCount`，也不能据此推导 uniqueWallets；统计值描述整个当前窗口。

### 证据引用口径

OnchainEvidence 按 `type` 区分三个严格对象：

| type | 必填引用 | 允许的可选引用 |
| --- | --- | --- |
| TRANSACTION | txHash、blockNumber | blockHash、contractAddress |
| BLOCK | blockHash、blockNumber | txHash、contractAddress |
| CONTRACT_EVENT | txHash、contractAddress、blockNumber | blockHash |

所有证据还必须有 trim 后非空的 description / source。txHash / blockHash 格式为 `0x` 加 64 位十六进制；contractAddress 为 `0x` 加 40 位十六进制；blockNumber 为非负安全整数。BLOCK 不要求制造一个交易哈希。

`description` 说明这条引用支持什么观察，`source` 使用可公开展示的来源标签或公开 URL，不放带凭据的 RPC URL、API key 或私密信息。Schema 只验证字段、格式和数值一致性；它不能证明交易存在、事件真实或统计正确。A 必须从真实数据读取和加工引用，B 通过这些引用调查和核验，不能补造哈希来“生成证据”。

有效信号示例（以下数值及哈希仅为合同示例）：

```json
{
  "signalType": "DEX_SELL_PRESSURE",
  "asset": "ETH",
  "windowStart": "2026-10-06T12:00:00Z",
  "windowEnd": "2026-10-06T12:05:00Z",
  "currentSellVolumeUsd": 300000,
  "baselineSellVolumeUsd": 100000,
  "anomalyRatio": 3,
  "txCount": 12,
  "uniqueWallets": 9,
  "evidence": [
    {
      "type": "TRANSACTION",
      "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "blockNumber": 24000000,
      "description": "当前窗口 ETH 卖出交易样本（Mock 合同示例）",
      "source": "Mock contract example"
    }
  ]
}
```

该例的基线窗口是 `2026-10-06T11:55:00Z` 至 `12:00:00Z`，不是信号对象中的新增字段。

### 并行交接边界与当前接入状态

A 负责读取、聚合、去重和 schema 验证，按以上结构向 B 交付；B 消费信号并调查，保留收到的输入与引用，不改写原始统计或补造引用。C 仍只能依据 PolicyDecision 执行，不能把 OnchainSignalState、证据文字或 Agent 推荐视为授权。D 展示统计窗口、异常比例与可核验引用。既有单向减风险、白名单、额度及执行后独立重读规则保持。

这次冻结新增 Domain 合同，**尚未把信号接入运行链路**。InvestigationResult.evidence 仍为 `string[]`；Risk / Investigation 的现有调用签名、RescueSession 及 `/api/rescue` 返回结构保持不变。DEX / 池范围、数据源、异常触发阈值、持续监控和重复执行保护属于后续实现任务；定义合同不代表真实链上监控或调查已经实现。

## Risk 与 Agent

Demo 确定性 score 为 `round(0.5 × volatilityScore + 0.3 × clamp(-priceChange1hPct × 10, 0, 100) + 0.2 × riskExposurePct)`；riskAssetUsd=0 时为0。调查前 RiskAnalysis 含 Pending investigation、confidence=0；调查后 Orchestrator 合成正式 Investigation，并将两处 confidence 设为相同值。

Investigation summary / primaryCause 非空，evidence / uncertainties 数组可为空。`recommendedAction` 只是建议；Policy 不依赖推荐动作或调查自由文本授权。Agent 没有执行接口。

## PolicyConfig / PolicyDecision

名单内 symbol 唯一，RISK 与 DEFENSIVE 名单不得重叠；空名单合法但不能授权交易。Demo 服务端配置为 score>80、confidence>0.85、exposure>70、maxDeRiskPct=30、allowedRiskAssets=[ETH]、allowedDefensiveAssets=[USDC]。

三项阈值使用严格 `>`，等于阈值不触发；还要求 maxDeRiskPct>0、存在有余额的允许 RISK 源资产及允许 DEFENSIVE 目标。源、目标不能相同，已有目标资产不能被标为 RISK。批准百分点不超过上限及源资产占组合总值的百分点。USDC 只是用户预先批准的 Demo 防御资产，不能称为无风险。

Schema 强制：

- 未触发：`action=NONE`，无 sourceAsset / targetAsset / reduceExposurePct。
- 已触发：`action=SWAP_TO_SAFE`，源/目标非空且不同，reduceExposurePct>0。
- reasons 至少一项。

单独的 PolicyDecision 不携带用户配置或资产类别；Schema 验证结构，PolicyService 依据组合和可信配置批准，ExecutionService / MockAdapter 再独立依据可信配置验证方向、名单和限额。通过 schema 不等于获得真实交易权限。

## ExecutionResult

- NONE 是跳过：success=false，只有 action/timestamp，没有资产、数量、hash、error。
- SWAP_TO_SAFE 必须有不同的 sourceAsset / targetAsset。
- 成功 swap：sourceAmount/targetAmount 有限且 >0，必须有 `0x` 加64位十六进制 txHash，不得有 error。
- 失败 swap：保留批准的资产和动作，必须有非空 error，没有交割数量；schema 允许可选 txHash，当前 Mock 失败不填造 hash。

ExecutionAdapter 只暴露 `execute(decision: PolicyDecision)`。ExecutionService 在调用外部 Adapter 前捕获批准内容，并校验结果动作与资产匹配；不能让 Adapter 更换批准内容。Executor 不返回 Portfolio 或“已经改善”的结论。Mock 的 txHash 明确是假哈希，不给真实区块浏览器链接。

## RescueSession / VerificationResult

Session 必须包含 market 和 verification；成功执行当且仅当存在 after。前后 wallet 相同；风险敞口匹配 before；riskAnalysis.confidence 等于 investigation.confidence；execution action / source / target 与 policyDecision 相同。

[verification.ts](../src/domain/verification.ts) 从独立重读数据核验：钱包相同，after.timestamp 不早于 before.timestamp 或 execution.timestamp，已提供的区块不倒退，源为 RISK / 目标为 DEFENSIVE，源减少与回执 sourceAmount 相符，目标增加与 targetAmount 相符，资产身份及非批准资产数量不变，after.riskExposurePct < before.riskExposurePct。验证还按 Market 报价重估 before 中对应资产的价值，其余资产使用快照估值，核对实际 sourceAmount 对应的组合百分点与批准 reduceExposurePct 相等，防止超卖仍被认定通过。数值比较拒绝非有限中间结果。SessionSchema 同时重算 status，拒绝伪造 PASSED。

| status | 含义 |
| --- | --- |
| SKIPPED | Policy 未批准，或批准执行失败；没有 after，不声称发生保护 |
| PASSED | 执行成功、独立重读且全部检查通过 |
| FAILED | 执行成功并保留 after，但敞口或余额/证据检查失败；到此停止 |

reasons 至少一项。成功回执不是验证成功；未改善可以是合法 FAILED Session。重读失败时整个 API 明确报错，不让 Executor 补造 after，不自动补偿或反向交易。

## HTTP 合同

`POST /api/rescue` 严格输入 `{wallet:string}`，trim 后非空；拒绝额外字段、动作、白名单/阈值和非法 JSON。200 直接返回新的 RescueSession，响应头 `X-Rescue-Mode: MOCK`、`Cache-Control: no-store`。

错误为严格 `RescueProblem`：

```ts
type RescueProblem = {
  type: string;
  title: string;
  status: 400 | 500;
  detail: string;
  instance: "/api/rescue";
  code: "INVALID_REQUEST" | "RESCUE_FAILED";
};
```

400/INVALID_REQUEST 表示请求错误，500/RESCUE_FAILED 表示配置或流程失败。Content-Type 为 application/problem+json；type 为 `urn:xjy:rescue:<code>`；不泄漏原始异常、端点或凭据。URL 不变，但旧借贷 DTO 被整体替换，不提供旧格式 shim。见 [Rescue OpenAPI](rescue-api.openapi.json)。

## Aave 可选扩展合同

主合同没有 Aave、debt、HF 或 REPAY 字段。现有 `/position`、`POST /api/position` 使用 [扩展本地 schemas](../src/extensions/aave/schemas.ts) / [types](../src/extensions/aave/types.ts)：AavePositionState 仍为 wallet/collateralUsd/debtUsd/healthFactor/ethPrice/timestamp/blockNumber?；ACTIVE 包含 position、marketChanges、evidence；NO_DEBT 包含 position=null、message、evidence，不产生假的 HF。

PositionEvidence 的 chainId/network/protocol、Provider/Pool/Oracle/WETH、blockNumber/hash/time 以及预留 txHash 保持；PositionMarketChanges 仍为真实7200区块窗口及实际秒数。查询不产生 txHash。HTTP 200/400/502/503、LIVE头、错误instance及canonical hash要求保持，详见 [Aave 文档](aave-position.md) 和 [Position OpenAPI](position-api.openapi.json)。该数据不作为核心 Portfolio 或5m/1h Market 的来源。
