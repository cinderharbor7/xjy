# Onchain 信号合同裁决

来源：用户要求“先冻结 OnchainSignalState 和 OnchainEvidence 两个合同”，并给出字段示例；本聊天后续四项回答是冻结口径。

- 仅增加 A→B 数据合同及校验、类型、测试和交接文档，不接真实链、不改现有 Mock / API / 执行权限。
- baselineSellVolumeUsd 必须 >0；为0时拒绝有效信号，不用null/Infinity/默认比值掩盖。
- anomalyRatio = currentSellVolumeUsd / baselineSellVolumeUsd，是倍数，不是百分比。
- 基线为紧邻之前的一个等长窗口总卖出额，不采用六窗口均值。
- 统计 ETH 总卖出额，不减买入；txCount 按发生 ETH 卖出的 txHash 去重，uniqueWallets 按这些交易 tx.from 去重，不按 router/池地址。
- Evidence 按type区分：TRANSACTION / CONTRACT_EVENT 必填txHash；BLOCK必填blockHash；CONTRACT_EVENT必填contractAddress。
- 沿用现有严格Zod/有限值/安全整数/UTC ISO校验习惯。合同冻结仅代表结构和这些口径固定，不代表真实采集、异常判定、连续监控或交易已实现。
- 合同冻结请求当时未授权新的commit/push，实施阶段保留为可审查工作树；后续发布授权见下方记录。

未决问题：本次两个合同范围内无。DEX/池配置、真实采集与调查实现、监控重复执行以及真实交易范围属于后续开发任务，不在本次决定。

## 发布授权补充（2026-10-07）

用户明确回复“你push吧”，授权将这轮已验证的合同、测试和交接文档提交并推送至 `https://github.com/cinderharbor7/xjy.git` 的 `main`。普通推送，保留现有历史，不使用force、不包含环境文件或范围外内容。这项授权仅改变Git发布范围，不改变上述数据裁决或现有运行流程。
