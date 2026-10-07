# A：真实 Ethereum 数据交接

本轮仅交付只读数据。交付分支为 `feat/a-live-data`，原开发分支 `feat/ethereum-live-data` 基于 `main` 提交 `1ab57ee`；不修改冻结 Domain、首页、现有 API、Mock、Risk、Investigation、Policy 或 Executor。B/D 可以消费三个独立合同，不需要依赖 A 的 RPC 内部字段。

## 读取入口

Node ≥22.12、pnpm 11：

```bash
pnpm install
# .env.local 设置 ETHEREUM_RPC_URL；已有环境变量优先。
pnpm data:read --help
pnpm data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --only portfolio
pnpm data:read --only market
pnpm data:read --only signal
pnpm --silent data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json
```

地址是公开只读测试地址，不是项目钱包。任意格式正确的 Ethereum 地址均可查询，包括零余额地址。默认 `--only all`；portfolio/all 需要 wallet，market/signal 不需要。命令不发交易，不需要私钥。`--json` 输出严格 JSON，脚本管道使用 `pnpm --silent` 隐藏包管理器命令前缀；失败 stdout 为空、stderr 含安全 code/message、退出码 1。help 不读取配置或访问网络。

必须配置支持 Ethereum 主网、EIP-1898 canonical hash 查询、最近一小时历史调用、区块、原始日志和交易查询的 HTTP(S) RPC。超时 10 秒，请求不自动重试；单个 client 的在途 RPC 上限 4。`.env.local` 不进入 Git，RPC URL、API Key 与底层异常不进入结果。`MOCK_MODE=true` 继续控制现有 Mock Demo，读取 CLI 与之独立。

## 三个输出

| 输出 | 固定范围与口径 |
| --- | --- |
| `PortfolioState` | 原生 ETH + 主网 USDC；分别按真实 ETH/USD、USDC/USD 估值。ETH 为 RISK，USDC 为 DEFENSIVE。totalUsd 与 riskExposurePct 只覆盖这两种资产，不包含 WETH、其他 ERC20、NFT、DeFi/Aave 仓位。零总值敞口为 0。 |
| `MarketState` | ETH 当前 oracle 价及 T−300/T−3600 秒的 oracle 价，变化为 `(当前 / 历史 − 1) × 100`。`volatilityScore=min(100, abs(priceChange1hPct) × 10)`，是用户批准的价格变化代理，不是统计波动率、Risk Score 或 Agent 置信度。 |
| `OnchainSignalState` | Ethereum 主网 Uniswap V3 WETH/USDC **0.05% 单池**，WETH 卖出归为 ETH。当前 `[T−300,T)` 对比紧邻基线 `[T−600,T−300)`，总卖出额不减买入。 |

T 是捕获的 latest 区块 UTC timestamp，不是客户端墙钟。时间点使用最大 `block.timestamp <= target` 的区块并检查下一块边界；不假定固定每 12 秒一个区块。latest 不是 finalized；结束时复核 canonical，发现重组失败，用户可发起新的读取。

余额与 `eth_call` 按 `blockHash` / `requireCanonical` 固定，同一次 all 读取共享锚点。每次程序服务 getter 则捕获新快照，包括未来执行后的独立重读；缓存只存在单次操作内。

### 报价与证据

| 合约 | Ethereum 主网地址 |
| --- | --- |
| Chainlink ETH/USD 普通 proxy | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| Chainlink USDC/USD 普通 proxy | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` |
| USDC，6 decimals | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| WETH，18 decimals | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Uniswap V3 单池，token0 USDC / token1 WETH / fee 500 | `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` |

两只价格 feed 均核对 description、8 decimals、正值及完整 round；相对**观测区块**，ETH updatedAt 超过 3600 秒、USDC 超过 82800 秒则报 `STALE_PRICE`，等于上限合法。`answeredInRound` 保留在证据中，已经 deprecated，不作为唯一新鲜度判据。证据包含 feed address、roundId、updatedAt、观测区块/hash/time 与公开来源链接。

Chainlink 按轮次更新，不是连续现货 tick；两个历史点可以来自同一轮次，0% 是合法 oracle 变化，不能推断现货没变化。USDC 不被假定为 $1；“防御资产”仍指用户白名单分类。

### 卖压识别

Swap amount0/amount1 是池余额变化；`amount1 > 0 && amount0 <= 0` 表示 WETH 输入卖出，成交美元额为 `(-amount0 / 1e6) × 事件区块的 USDC/USD`。允许合法零 USDC 输出卖出；它计入交易数但金额为 0。

原始日志逐条严格解码并重新编码核对规范 ABI，核验池、removed、区块/hash、真实 timestamp 和交易引用。同一个 blockHash/logIndex 的重复日志只计一次，冲突拒绝；同交易不同日志金额全部计入。当前 txCount 按卖出 txHash 去重，uniqueWallets 按真实交易 `tx.from` 小写去重，不按事件 sender/router/池地址。该数可以包含 bundler、机器人，不表示自然人数。

金额和计数使用窗口内全部日志；事件证据最多抽样 20 条并附相应报价证据，不能用 evidence.length 当 txCount。`anomalyRatio = 当前 gross USD / 正基线 gross USD`。基线为 0 报 `EMPTY_BASELINE`，不生成有效信号，不填无限值/默认比例。单池不是全市场卖压；signal 的采集不是异常触发条件，B 决定如何分析。

## B / D 集成

```typescript
import { createEthereumReadClient, createEthereumDataServices } from "@/modules/onchain/live-data";

// 只能在服务端读取配置；不把 RPC URL 传给浏览器或请求方。
const services = createEthereumDataServices(createEthereumReadClient(process.env.ETHEREUM_RPC_URL!));
const portfolio = await services.portfolio.getPortfolio(wallet); // PortfolioState
const market = await services.market.getMarketState();          // MarketState
const signal = await services.signal.getSignal();               // OnchainSignalState
```

需要出处时可使用 `EthereumPortfolioAdapter.readPortfolio(wallet)`、`ChainlinkMarketAdapter.readMarket()`，返回 `{state, evidence: OnchainEvidence[]}`，或 `readEthereumData(client, {section:"all", wallet})` 获取同锚点 JSON 外壳。这个外壳只用于读取展示，不替换 Domain DTO。

| 所有人 | 接下来负责 |
| --- | --- |
| A | `modules/portfolio/ethereum-portfolio.adapter.ts`、`modules/market/chainlink-market.adapter.ts`、`modules/onchain/`；采集与出处、故障处理。 |
| B | `modules/risk/`、`modules/investigation/`；消费这三个输出，判断异常、生成有依据的分析。当前 Investigation 仍是 Mock，`string[]` evidence 未自行修改。 |
| C | `modules/policy/`、`modules/execution/`；Policy 权限、白名单、额度与受限执行，当前换币仍为 Mock。 |
| D | `app/`、`integration/`、`modules/rescue/`；接真实读取 HTTP/UI、监控入口、分析流程和重读展示。当前没有新增 HTTP 或监控调度。 |

真实读取服务尚未注入首页的 Rescue composition root。不得仅设置 `MOCK_MODE=false` 就启动真实救援；该模式仍明确拒绝。只读数据不赋予 Agent 执行权。

## 验收标准

- [ ] `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过；help 在无 RPC 配置下成功。
- [ ] portfolio 命令输入真实地址，显示 ETH、USDC、两种资产 USD 总值及敞口；JSON 的 block/hash/合约地址和 round 信息可由来源核验，零余额合法。
- [ ] market 命令显示当前/5m/1h oracle 数据，证据说明目标与实际区块时刻；波动代理公式正确，0% 不被当成失败或连续 tick。
- [ ] signal 命令显示两个相邻 300 秒窗口、真实 gross sell USD、有限 ratio、去重交易/发起者数量和结构化证据；零基线/坏日志明确失败。
- [ ] JSON 输出符合冻结 DTO 和严格读取外壳；坏地址在 RPC 前拒绝，RPC/过期价格/重组失败无 Mock 替补，无凭据泄漏。
- [ ] 首页 `/api/rescue` 仍运行原 Mock 闭环，Aave `/position` 扩展测试通过；没有签名或写链。

最终真实 RPC 与全量验证记录见 [A 执行计划](loopx/plans/2026-10-07-ethereum-live-data.md)。行情与余额随链变化，不以固定数值作为后续验收要求。

## 官方依据

地址/池与 Swap 语义：[Uniswap 官方 primer](https://blog.uniswap.org/uniswap-v3-math-primer)、[官方事件定义](https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol)、[官方实现](https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol)。

价格轮次与历史读取：[Chainlink API reference](https://docs.chain.link/data-feeds/api-reference)、[Chainlink ENS](https://docs.chain.link/docs/ens)、[Feed metadata](https://reference-data-directory.vercel.app/feeds-mainnet.json)、[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)、[Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)。
