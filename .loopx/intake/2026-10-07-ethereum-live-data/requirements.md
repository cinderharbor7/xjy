# A 真实只读数据需求

目标：输入Ethereum钱包，读取真实ETH/USDC组合，产出真实MarketState及单池OnchainSignalState，供B/D独立接入。来源为clarification中的用户请求与三项裁决。

## Acceptance Criteria

- AC-001：仅Ethereum mainnet，只读RPC，不签名、不执行、不启用真实Rescue。钱包ETH+USDC范围明确，合法地址含空余额均可查询。
- AC-002：getPortfolio返回冻结PortfolioState；ETH18位、USDC6位余额和各自真实USD报价正确，类别/总值/敞口一致，同一查询固定canonical区块，保留引用；重读重新捕获区块。
- AC-003：getMarketState返回冻结MarketState；5m/1h按真实时间查历史区块，报价有出处/更新时刻；采用用户批准代理公式，不称统计波动率或连续现货行情。
- AC-004：getSignal返回冻结OnchainSignalState；固定单池、5分钟与前一等长窗口，gross卖出按USDC报价计USD；严格区分买卖，金额统计所有卖出日志，tx/wallet按冻结去重口径；零基线拒绝有效信号。
- AC-005：提供新增只读Adapter/service与验收CLI，保留原接口/合同/Mock/HTTP；B/D只消费既有Domain结构与Evidence，不访问实现内部字段。
- AC-006：RPC/ABI/时间/数值/身份/引用异常、stale报价、reorg明确失败，错误不泄露RPC凭据。所有余额/eth_call使用blockHash+requireCanonical，不静默丢掉异常日志。
- AC-007：关键单测、全量typecheck/test/build及独立exact-diff审查通过；真实RPC验收结果明确区分实测/未测；README与A交接文档准确，不提交环境文件，不自动Git发布。

## Acceptance Scenarios

| TC | AC | 场景 |
|---|---|---|
| TC-001 | 001,002,006 | 合法/非法地址、零余额、单位、非$1 USDC、错链/错区块/坏余额、重复读取fresh捕获 |
| TC-002 | 003,006 | 时间二分含精确/间隙边界、历史点证据、同轮次0%、涨跌与代理公式、坏/未来/过期oracle、重组 |
| TC-003 | 004,006 | 买卖/零输出、多事件同tx、日志去重/冲突、窗口边界、事件区块USD报价、tx.from去重、坏引用/日志、零基线 |
| TC-004 | 005,006 | CLI help、非交互输入/JSON/错误、仅portfolio/market/signal及完整读取、凭据脱敏、全链路只读 |
| TC-005 | 005,007 | 旧Mock/HTTP/Aave回归，全量检查、真实只读实测、文档及独立审查 |

未决问题：本次范围内无。监控、真实调查/交易和异常阈值不属于A。
