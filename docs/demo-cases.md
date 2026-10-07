# A → B / D：真实数据与案例交付

2026-10-07，Asia/Shanghai。沿用[比赛冻结方案](loopx/design/2026-10-07-hackathon-freeze/需求设计文档.md)；本轮只做 A 的链上读取、证据和交接，未修改前端、公共合同、分析方法或执行流程。

**A 的现有读侧已可用，本轮重新完成主网实测并保存输出。** B 可以拿同一快照做分析，D 可以通过既有接口展示。本页和 JSON 是带日期的历史读取记录，不是当前在线结果，不能用它们替代失败的查询。

## 1. 给 B、D 的入口

| 用途 | 入口与文件 | 返回及注意事项 |
| --- | --- | --- |
| A 的同一观察周期数据 | [`readEthereumData(client, { section: "all", wallet })`](../src/modules/onchain/live-data.ts) | `portfolio.state`、`market.state`、`signal` 及独立 evidence；共同锚点和 UTC 时间 |
| 已集成的 A → B 分析 | [`analyzeOnchainData(client, wallet)`](../src/integration/onchain-analysis.ts)；`pnpm data:analyze --wallet ADDRESS --json` | 上述真实数据加 B 的规则 `RiskAnalysis`；本轮未修改 B |
| 单项公共服务 | [`createEthereumDataServices(client)`](../src/modules/onchain/live-data.ts) | `portfolio.getPortfolio(wallet)` / `market.getMarketState()` / `signal.getSignal()`；分开调用分别捕获快照，不能假定是同一周期 |
| 具体交易核验 | [`checkTransaction(txHash)`](../src/integration/transaction-check.ts)；既有 `POST /api/transaction-checks` | `TransactionCheckReport`；本次实测的是服务入口，HTTP/页面由 D 继续验收 |
| 本机 Fork 读侧 | [`ForkObservationReader.read(wallet)`](../src/modules/onchain/fork-observation-reader.ts) | 既有 [`ForkReadBridge`](../src/integration/guardian/fork.ts) 装配；固定钱包的 WETH/USDC 与 V2 spot quote，本轮未重新运行 Fork |

数据合同真源保持原样：[`PortfolioState / MarketState / RiskAnalysis`](../src/domain/schemas/index.ts)、[`OnchainSignalState / OnchainEvidence`](../src/domain/schemas/onchain.ts)、[`EthereumDataResult`](../src/modules/onchain/read-results.ts)、[`TransactionCheckReport`](../src/domain/schemas/transaction-check.ts)。不另造 snake_case 或新的前端专用合同。

主网 Portfolio 只覆盖**原生 ETH 和 USDC**；逻辑资产 ETH 没有 ERC20 地址。Fork 的逻辑 ETH 是 **WETH ERC20**，原生 ETH 只支付 gas。主网 V3 调查池和 Fork V2 执行池是不同范围；主网 Portfolio 不能直接作为 Fork 可交易余额。

## 2. 实测的真实窗口

命令在北京时间 **16:49:42—16:50:23** 成功退出（exit 0）：

```sh
pnpm --silent data:analyze --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json
```

完整输出：[onchain-analysis.json](evidence/2026-10-07-a/onchain-analysis.json)。采集时间、来源代码 commit、命令与文件摘要：[capture-manifest.json](evidence/2026-10-07-a/capture-manifest.json)。示例钱包是公开地址，不宣称所属身份，也不代表项目持有、控制或获得了该钱包授权。

| 项目 | 本次真实值 |
| --- | --- |
| 网络 / 模式 | Ethereum mainnet / `LIVE_READ_ONLY` |
| 锚点 | [区块 26139420](https://etherscan.io/block/26139420)，`2026-10-07T08:49:35.000Z`（北京时间 16:49:35） |
| 锚点 hash | `0x26f371791423f3fec0537e3bdc1c7c40662647316f00ea2b634f382a55babf29` |
| 当前窗口 | `[2026-10-07T08:44:35.000Z, 2026-10-07T08:49:35.000Z)` |
| 基线窗口 | `[2026-10-07T08:39:35.000Z, 2026-10-07T08:44:35.000Z)` |
| 当前 gross sell USD | `6606.234431430931` |
| 基线 gross sell USD | `255825.1782661456` |
| anomalyRatio | `0.025823237869722855`，即当前卖出额 ÷ 基线卖出额 |
| 当前卖出交易 / 原始发起钱包 | `3 / 3`；txHash / tx.from 分别去重 |
| 范围内 Portfolio | ETH `5.7535220303394325`；USDC `37.192124`；估值合计 USD `15080.462328613317` |
| Chainlink ETH/USD | `2614.62` |
| 5m / 1h oracle 变化 | `0% / -0.11679438103390227%` |
| volatilityScore | `1.1679438103390227`，1h 变化代理 |
| 既有 B 规则输出 | Risk Score `21`；Confidence `0.63` |

**本次当前窗口卖压低于基线。** 不要求出现异常，不把它改成 Risk 91，也不把该样本当成 ETH 全市场风险结论。B 的分数和 Confidence 是未校准启发式，不是未来跌价概率；当前工具没有真实 LLM/自主 Agent。

报价与卖压来源：

- [Uniswap V3 WETH/USDC 0.05% 池](https://etherscan.io/address/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640)：只累计 WETH 卖出的实际 USDC 输出，不减买入；USD 按事件区块的 [Chainlink USDC/USD](https://etherscan.io/address/0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6) 换算，不假定 USDC=$1。
- [Chainlink ETH/USD](https://etherscan.io/address/0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419)：锚点与 5m 快照采用同一报价 round，更新时间为 `08:24:23Z`；因此 5m oracle 变化为 0，不证明现货价格没有变化。1h 快照报价更新时间为 `07:23:59Z`。详细 roundId、实际观察区块及 timestamp 保留在 JSON evidence 中。
- 本次读取涵盖两个窗口共 `24` 条去重 Swap，报告含 `19` 条卖出事件引用及其报价引用，共 `39` 个 signal evidence。代码最多抽样 `20` 条卖出事件；evidence 数量不是当前交易数，也不保证其他窗口保存全部原始日志。保存的 19 条卖出引用已离线复算总额、当前交易/钱包去重及比值；未做第二个独立节点或全部 raw Swap 日志的复核。
- 使用最新区块锚点、按 hash 读取并在结束时复核 canonical；最新区块不等于已最终确认。引用的浏览器页面供人工核查，本轮未将浏览器显示当作独立节点验证。

## 3. 两个主案例与一个反向备用案例

以下三笔均在北京时间 **16:50:36—16:50:52** 通过既有 `checkTransaction(txHash)` 重新从配置 RPC 读取，报告 schema 通过。**链上发生时间**与**本次核验时间**分别记录，不能混用。

| 案例 | 确认事实 | 区块 / 链上 UTC 时间 | 原始输出与出处 |
| --- | --- | --- | --- |
| 主案例 1：大额外层转账 | 成功交易附带 `20059.2 ETH`，input=`0x`，回执 0 条日志；`NO_SUPPORTED_SWAP` | `20449709` / `2024-08-03T18:08:23.000Z` | [保存的报告](evidence/2026-10-07-a/native-transfer.json)；[交易](https://etherscan.io/tx/0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a)；[区块](https://etherscan.io/block/20449709) |
| 主案例 2：本池卖出 | 日志 `12`：`0.198 WETH → 517.590594 USDC`；`SUPPORTED_POOL_SELL` | `26138703` / `2026-10-07T06:25:23.000Z` | [保存的报告](evidence/2026-10-07-a/pool-sell.json)；[交易日志](https://etherscan.io/tx/0x310948594828e864aff5f1bc133968b80889379ec66091e734a6758bf8abc9e9#eventlog)；[区块](https://etherscan.io/block/26138703) |
| 备用：本池买入 | 日志 `1049`：`259.31045 USDC → 0.099098067895988648 WETH`；`SUPPORTED_POOL_BUY` | `26138703` / `2026-10-07T06:25:23.000Z` | [保存的报告](evidence/2026-10-07-a/pool-buy.json)；[交易日志](https://etherscan.io/tx/0x6cf0da2d2749fe1f12c8120f03f29fa4b5c4e0964f1117f2787a11c5a6ee25dc#eventlog) |

发起、接收地址、blockHash、input、精确代币数量、出处、核验时间和未知项均保留在报告。金额为十进制字符串；单笔 USDC 数量没有历史 USD 报价，**不能标成美元金额**。

主案例 2 的外层 value 是 `0.2 ETH`，本池兑换是 `0.198 WETH`；报告区分两个事实，不用其中一个替代另一个，也不推测差额用途。池内方向不能升格为整笔交易/钱包的净买卖方向。主案例 1 未发现支持池的兑换，不证明全链没有卖出，也不核实身份、动机或后续路径。

这三个案例不在第 2 节当前窗口内，且大额转账发生于 2024 年。展示时分别讲“当前窗口量化”和“历史交易核验”，不能声称当前指标事前预判了这些交易或解释了 ETH 下跌。

## 4. 复现与失败验收

配置按[真实读侧说明](ethereum-data.md)填写服务端 `ETHEREUM_RPC_URL`；主网 chain id=1，RPC 需支持历史区块、日志和 `blockHash + requireCanonical` 读取。不需要私钥、钱包签名或 LLM key。

```sh
# A 的数据入口；返回新的当前窗口，不会固定为本页数值
pnpm data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json

# 已有 A → B 单次分析
pnpm data:analyze --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json

# D 启动现有服务后，使用已有 HTTP 接口；本轮没有做 HTTP/浏览器复验
curl -s http://localhost:3000/api/transaction-checks \
  -H 'Content-Type: application/json' \
  -d '{"txHash":"0x310948594828e864aff5f1bc133968b80889379ec66091e734a6758bf8abc9e9"}'
```

验收逐项检查：共同 wallet/锚点/UTC 时间、两个紧邻等长窗口、`current / baseline`、数量/方向/引用、公共 schema。基线为零、无效钱包、错链、过期报价、RPC 失败、坏数据或重组必须明确停止；不拿保存输出、旧数据或 Mock 补齐。

本轮主网成功读取不代表公共 RPC 长期稳定，也不证明已完成 HTTP/浏览器或 Fork 验收。读取失败时应保留错误和时间，修复配置后手动重新查询；本轮未新增 fallback、自动重试或真实交易权限。

## 5. 接下来各人拿什么

- **B：**拿完整窗口 JSON 和三个案例，补方法卡、事实/解释/未知项及真实 AI 对照；没有实测的增益不写入成果。
- **C：**顺序复核数字、报价/窗口、证据边界和失败反例；另行验收原 Mock/Fork 保护实验。P-002 还包含这些工作，不能因 A 已交付就将整项标为完成。
- **D：**使用现有接口做页面/HTTP 验收，统一讲稿、PPT 与录屏；清楚区分实时查询、日期明确的历史记录和独立保护实验。

A 本轮未改页面、Risk/Investigation、Policy/Executor、HTTP 路由或持久状态；没有签名、swap、部署或真实 AI 调查。后续现场数据不必与本页数值相同，但必须按同一合同和口径通过校验。

## 6. 本轮验收记录

| 检查 | 实际结果 |
| --- | --- |
| 修改前 `pnpm test` | 16:49，896 passed / 2 skipped |
| 修改后 `pnpm typecheck` / `pnpm test` / `pnpm build` | 全部 exit 0；16:53 的测试为 896 passed / 2 skipped。两项既有 Fork 测试跳过，未计为通过 |
| 主网只读 | 一个完整共同窗口、三笔历史交易重新读取成功；四份保存输出通过现有 runtime schema |
| 保存证据离线复核 | SHA-256、锚点、窗口/比值、19 条卖出引用总额与当前交易/钱包去重、volatility 代理、三个案例方向/精确数量通过；既有 B 用保存输入重算一致 |
| 非法钱包 CLI | `bad-wallet` 返回 `INVALID_WALLET`、exit 1、stdout 无仓位；没有 Mock 输出 |
| 文档与独立审阅 | 本轮三个文档的本地链接及 `git diff --check` 通过；独立审阅全部新增输出与文档，未发现需修正问题；新增输出未含 RPC URL 或凭据 |
| HTTP / 浏览器 | 未完成。本机 `GET /investigate` 预检返回 502；未进行交易查询 API/页面复验，留给 D 检查服务装配 |
| Fork / AI / 需求对照 | 本轮未运行，不声称通过 |

A 的交付标准是：有效地址得到真实、合同通过的同周期数据；至少两个案例的金额、区块、方向和来源可复查；非法输入和读取失败明确停止；保存记录与在线查询有清楚区别。回归测试通过只证明代码回归，不替代主网/Fork现场验收。独立离线审阅也不证明 RPC 来源真实或原始日志覆盖完整。
