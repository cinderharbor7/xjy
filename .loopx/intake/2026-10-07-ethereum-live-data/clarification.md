# A：真实 Ethereum 数据接入裁决

来源：用户“ A分工开始吧 ”以及随后三项明确答复。

- 钱包仅统计原生 ETH + USDC；其他资产不进入本阶段totalUsd和敞口，必须标注范围。
- Ethereum mainnet Uniswap V3 WETH/USDC 0.05%单池；当前5分钟与紧邻之前5分钟比较。WETH卖出归为ETH；USD按实际USDC成交额乘对应区块的真实USDC/USD报价计算。
- 行情采用Chainlink；沿用MarketState，volatilityScore=min(100, abs(priceChange1hPct)*10)，明确为波动代理而非统计波动率/风险分数。
- 保留所有冻结合同、现有Mock首页/API及B/C逻辑。A交付三个既有Domain对象、OnchainEvidence引用和独立只读验收入口；D后续负责页面/监控/Rescue装配。
- 普通RPC只读访问不需要签名/私钥；失败明确报错，不重试、备用源或补造Mock数据。本轮未请求commit/push。

工程证据：基线283项测试通过；既有PortfolioAdapter.getPortfolio与MarketAdapter.getMarketState可直接替换实现；Onchain合同已冻结。已有Aave扩展保持独立。

技术核验：官方Uniswap单池地址及有符号Swap；Chainlink普通proxy ETH/USD及USDC/USD，heartbeat分别3600/82800秒；价格5m/1h以真实区块时间取oracle快照，可能同轮次而变化0%。不能称连续现货行情。

本阶段无未决数据口径。具体异常分数、调查/策略、定时监控或真实交易仍由后续B/C/D任务承担。
