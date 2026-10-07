# A → D：团队集成读侧交付

日期：2026-10-07。对应 [D2A-handoff.md](D2A-handoff.md)，交付于 `codex/integrate-guardian`。最新实测见 [团队验收](docs/team-integration-acceptance.md)；原交接文档中的待验收状态保留为交接时的历史记录。

1. **WETH balance 作为 ETH 逻辑资产余额：同意，已实现。** Fork 只读 WETH/USDC ERC20；原生 ETH 不计可交易资产，仅用于 gas。
2. **读侧钱包必须等于受保护钱包：同意，已实现。** 读侧校验请求地址与配置钱包，忽略大小写；D 校验签名钱包/请求和持久状态绑定。
3. **ETH tokenAddress 使用 WETH：同意，已实现。** Portfolio 的 ETH/USDC 条目保留配置中经链上核对的地址。
4. **行情使用 WETH/USDC V2 spot quote：同意，已实现。** 校验 factory pair 非零、token0/token1 恰为两个批准资产、两边储备正数、WETH/USDC decimals 为18/6，按正确顺序计算。USDC=$1仍为本机 Demo 估值假设。
5. **Portfolio 与 Market 接口/位置：** `src/modules/onchain/fork-observation-reader.ts` 的 `ForkObservationReader.read(wallet)` 返回 `{portfolio, priceUsd, block}`。D `ForkReadBridge.observation()` 负责 Anvil实例预检，`runtime.ts` 通过 PortfolioService/MarketService 使用第一次共同观察的余额/价格；执行后调用新的观察。A 的主网 `EthereumPortfolioAdapter` 仍统计原生 ETH，不能与此读侧互换。
6. **blockNumber/timestamp：** 来自实际区块的 number/hash/timestamp。所有 balance/pair 调用指定 canonical blockHash，结束再按区块号复核 hash/time。成功执行时间来自已确认交易的 canonical receipt block；journal intent 时间仍为墙钟。不会用墙钟刷新陈旧链上数据。
7. **失败与错误：** A 使用 `EthereumReadError`：`CONFIGURATION_ERROR`、`INVALID_WALLET`、`UNSUPPORTED_NETWORK`、`INVALID_CHAIN_DATA`、`REORG_DETECTED`、`RPC_READ_FAILED`。D 的 Anvil/HTTP/监控层继续提供脱敏控制面错误；读取异常不返回旧数据或 Mock。广播后的 hash 保留并只查原 hash。
8. **真实5m/1h/volatility：** Fork 交易流程尚未提供，继续明确为 D/B Demo 输入。独立主网 A→B `data:analyze` 使用 Chainlink 当前/5m/1h报价及已批准的1h变化代理，不代表 Fork 已接入真实异常监控或经过校准的波动模型。
9. **代码/测试：** 新 canonical ForkReader及99项针对性测试，装配共周期报价、独立 after、canonical receipt time、Mock余额保留和迟到事件所有权回归。完整 HTTP/Fork 两次事件已实际执行并独立验证 PASSED，重启和暂停/恢复未重复 swap。
10. **限制：** 本机 Anvil、固定一个同签名钱包、WETH→USDC单跳 V2；需间隔出块保持区块时间新鲜。真实卖压监控/恢复判据仍待 B/D交付，调查为规则/Mock而非真实LLM；没有主网交易或多钱包授权。

冻结的 `PolicyDecision`、`ExecutionAdapter`、`ExecutionResult` 和其他 Domain schema保持原样。A 不调用 Executor、不管理签名、HTTP、事件恢复或验证结论。
