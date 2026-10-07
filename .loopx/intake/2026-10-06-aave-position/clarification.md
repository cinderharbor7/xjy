# Aave 真实仓位读取澄清

来源：用户本轮 A｜链上数据 / Aave TODO 与“输入钱包地址，可以成功显示真实仓位”里程碑。

- 用户授权创建 `feat/` 分支并实现真实只读查询，功能分支为 `feat/aave-position`。
- 用户确认保留既有 camelCase PositionState；行情和证据置于独立查询响应，不迁移旧消费者。
- 用户确认无借款时返回明确的无借款结果，不生成 PositionState，不制造 HF。
- 本轮只读取 Ethereum 主网 Aave V3 Core；不创建仓位、不签名、不执行交易、不接入真实救援或 LLM。
- 当前 79 个测试基线通过，Git 起点 main 干净，ETHEREUM_RPC_URL 未配置。
- Aave USD base unit / HF 精度以及无债务 sentinel 已由官方源码与真实 RPC 验证。只读 eth_call 不产生交易 hash。
- 测试地址和既有 Borrow tx 由真实回执与日志验证；不会把它们解释为本次读取交易。
- 价格变化采用 7200 区块窗口并记录实际区块时间，非精确 24 小时。
- 未决问题：无。
