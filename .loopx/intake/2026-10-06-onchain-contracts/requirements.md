# OnchainSignalState / OnchainEvidence 冻结需求

唯一需求来源为用户两合同示例及clarification记录的明确回答。目标是A加工链上数据后，B能按同一字段/口径消费。只新增合同，不扩运行能力。

## Acceptance Criteria

- AC-001：两个命名Zod schema及z.infer类型可从现有domain公共入口导入；对象strict，不混入Portfolio/Market，也不携带执行权限。
- AC-002：仅支持ETH / DEX_SELL_PRESSURE；保持用户Signal字段；UTC半开窗口[start,end)且start<end；当前总卖出USD非负有限，前一个等长窗口基线正有限，ratio为有限current/baseline倍数。
- AC-003：计数为非负安全整数，按去重交易/tx.from口径；wallets<=txCount，txCount0不可有正当前卖出额；evidence可为样本或空，不用长度推算txCount。
- AC-004：三个Evidence类型使用必需的真实引用字段，hash/address格式正确，blockNumber非负安全整数，source/description trim非空；BLOCK不强制伪造txHash。
- AC-005：交接说明固定A生产、B消费调查、C仅受Policy授权、D后续装配；README状态准确；全部现有签名/Session/HTTP/Mock行为不变。
- AC-006：新合同边界及JSON示例通过测试，typecheck/test/build通过，独立审查；不接真实服务。冻结实施阶段不提交推送，后续发布按clarification中的明确授权执行。

## Acceptance Scenarios

| TC | AC | 场景 |
|---|---|---|
| TC-001 | 001,004 | 三种证据通过，缺引用/非法hash/address/block/source/未知字段拒绝 |
| TC-002 | 002 | 示例ratio3与当前0/baseline正的ratio0通过，baseline0/负值/非有限/ratio不符/除法溢出拒绝 |
| TC-003 | 002,003 | 窗口反向/等长零时长/非UTC/坏时间、负数/分数/不安全计数、wallets超tx与无tx正USD拒绝 |
| TC-004 | 001,005 | 公共infer类型可用，例子可读，旧Investigation string[]和Mock happy path保持 |
| TC-005 | 005,006 | 文档与实际schema一致、fresh全套验证、独立exact diff审查 |

未决问题：无。真实A查询/信号选择、B评分和置信度算法、D监控装配另属后续实现；不得把合同冻结描述为这些功能已完成。
