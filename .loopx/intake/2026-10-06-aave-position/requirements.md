# Aave 真实仓位读取需求

本轮交付真实 Ethereum/Aave 仓位查询与最小展示。保留 Mock Demo 与八个原有契约，全部新增读取采用只读路径。

## Acceptance Criteria

- AC-001：在 `feat/aave-position` 开发，不提交、推送或合并本轮修改。
- AC-002：AavePositionAdapter 实现原 PositionAdapter，给 B 提供 PositionState camelCase JSON。
- AC-003：输入有效 Ethereum 地址，读取真实 collateral、debt、HF、Aave WETH/USD 价格，并以同一区块组成快照。
- AC-004：NO_DEBT 返回明确结果和证据，position=null，不将 Aave sentinel 转成假 HF。
- AC-005：独立响应带行情变化和链上 address/block/hash；只读查询无 txHash，既有测试借款交易另作证明。
- AC-006：查询 ETH 7200 区块价格变化，返回真实参考时间与当前区块，历史读取失败明确报错。
- AC-007：POST /api/position 与 /position 页面提供稳定查询展示，不调用救援、Agent 或 Executor。
- AC-008：使用官方地址包与可配置主网 RPC；没有真实私钥、签名、交易、数据库、队列、fallback 或 retry。
- AC-009：保留全部 Mock 流程和既有接口，并通过 typecheck/test/build、独立 diff 审查。
- AC-010：固定公开借款钱包来源证据，并实际完成 live API 与浏览器验收；实时数字允许随区块变化。

## Acceptance Scenarios

- TC-001 / AC-002,003,005：有债务账户精度转换、区块一致性、完整 JSON。
- TC-002 / AC-004：空仓位与仅抵押无借款均 NO_DEBT，PositionAdapter.getPosition 明确拒绝无法生成的 PositionState。
- TC-003 / AC-003,006,008：RPC 错链、无效地址、零/无效价格单位、异常 HF、历史读取失败、依赖超时均报错且不回落 Mock。
- TC-004 / AC-007,009：真实查询与 Mock API/UI 分离；既有 79 测试保持通过。
- TC-005 / AC-001,008,010：分支名、只读代码边界、测试 Borrow 回执、live 查询和浏览器实测。
