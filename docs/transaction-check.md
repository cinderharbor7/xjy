# Ethereum 交易核验 MVP

使用情境：链上新手看到“大额 ETH 转账”等消息，拿到交易哈希后，希望先核对具体发生了什么，再判断原消息是否超出了证据。这个版本验证技术和解释闭环；付费意愿与商业需求仍待验证。

## 启动

```sh
pnpm install
cp .env.example .env.local
# 编辑 .env.local，填写 ETHEREUM_RPC_URL
pnpm dev
```

已有 `.env.local` 时直接编辑，不要覆盖现有配置。打开 <http://localhost:3000/investigate>。RPC 必须连接 Ethereum 主网（chain id 1），支持交易、回执、区块查询及历史 `eth_call` 的 `blockHash + requireCanonical`。只需 RPC，不需钱包、私钥或 LLM key。Guardian 的 Mock/Fork 设置不决定此查询的数据来源。

## 读到什么

`页面 → POST /api/transaction-checks → 只读 Reader → 中文解释 Service → Zod 报告`

- 外层交易：from/to、精确 ETH value、input、成功/回滚、区块及时间、回执日志数。回滚交易的 value 是尝试发送的值，不能称为成功转账。
- 指定池事件：Uniswap V3 WETH/USDC 0.05%，地址 `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`。按历史区块核验 token 顺序、fee 和 decimals；严格解码并检查事件引用。池收到 WETH 并付出 USDC 才归为本池卖出，反向归为买入，两种方向并存则单独报告。
- 金额用十进制字符串，避免浮点数损失。USDC 是成交代币数量，没有假定等于美元。
- 来源：交易、区块及池合约的 Etherscan 引用。解释、不能确认项与下一步均由规则生成；没有虚构 Confidence 或 Risk Score。

未发现本池 Swap，只表示本次覆盖范围没有对应证据。不会据此保证全链没有卖出。发现本池事件也不能证明交易发起人的身份、意图、全笔净方向、后续卖出或 ETH 价格下跌原因。当前不读取内部 trace、其他池、CEX 账内活动或后续资金路径。

## 接口

```sh
curl -s http://localhost:3000/api/transaction-checks \
  -H 'Content-Type: application/json' \
  -d '{"txHash":"0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a"}'
```

请求只接受 `txHash`；不接受用户提供的 RPC、钱包或指令。返回 `TransactionCheckReport`，包括 `mode: LIVE_READ_ONLY`、`network: ethereum-mainnet`、`observation`、`classification`、中文说明和核验时间。合同真源在 `src/domain/schemas/transaction-check.ts`。旧公共合同无需更改。

当前共享 HTTP 校验要求 Content-Type 的媒体类型值使用小写 `application/json`（可带参数）；`Application/JSON` 会返回 415。这是现有实现限制，页面和上述 curl 均使用小写值。

| HTTP | 含义 |
| --- | --- |
| 200 | 已上链交易报告；回滚也返回报告，但无成功兑换结论 |
| 400 | JSON 或哈希无效，或多余字段 |
| 403 / 415 | 本机同源限制，或未使用 application/json |
| 404 | 当前主网 RPC 未找到交易 |
| 409 | 尚未确认上链 |
| 503 | 配置、RPC、错链、数据一致性或区块重组问题 |

响应均 `no-store`。错误为 `application/problem+json`，固定安全文案；不会返回含 key 的 RPC URL、原始 provider 异常、旧数据或 Mock。没有自动重试。网络异常修复后可手动再查。

## 验收

1. 输入示例哈希，确认读取到 **20059.2 ETH**、2024-08-03 的真实外层交易，并明确说明本次范围未证实卖出。交易身份和原消息描述不能被当成已核实事实。
2. 输入指定池真实 Swap 交易，确认方向、WETH/USDC 精确数量、池地址、区块与来源；不能把局部事件升格成全笔净方向或下跌原因。
3. 无效哈希、未找到、待确认、错链、坏数据和 RPC 失败分别停止并给出明确错误。配置缺失时不展示成功或 Mock 结果。
4. 新查询不需要钱包连接，不出现交易批准，不改变 Guardian 的事件记录。既有合同与行为回归保持通过。
5. 执行 `pnpm typecheck`、`pnpm test`、`pnpm build`。有配置的真实 HTTP 与浏览器核验另外记录，单元测试 fixture 不算主网验收。

OpenAPI 文档由 Zod 转出，跨字段精化仍以 runtime 校验为准。仓库没有专用 OpenAPI validator；本地检查 JSON、引用、请求/响应示例与合同的一致性。

## 代码边界

| 目录 | 责任 |
| --- | --- |
| `src/modules/transaction-check/` | 主网只读 client、事实校验与规则解释 |
| `src/domain/schemas/transaction-check.ts` | 局部请求、事实、报告与错误合同 |
| `src/integration/transaction-check.ts` | 服务器 RPC 装配，无执行依赖 |
| `src/app/api/transaction-checks/` | 本机 HTTP 边界与安全错误 |
| `src/app/investigate/` | 中文查询页面 |

当前没有新增存储、轮询、主网执行或跨链能力。历史研究文档仅作背景，不参与线上数据生成。

## 2026-10-07 验收记录

- 最新检查：`pnpm test` 在 14:33 为 **896 passed / 2 skipped**；`pnpm typecheck` 通过；修复后 `pnpm build` 通过。新增四个测试文件共 127 项通过。跳过项是既有 Fork 测试，需要显式环境配置，未视为通过。
- 真实主网 RPC 与 HTTP：下表三笔交易均成功返回 live 报告。未找到返回 404，无效输入和附带 RPC 字段返回 400，均无缓存或 Mock。
- 浏览器：真实转账示例、真实卖出、无效格式、未找到交易均完成；修改输入会清除旧报告。截图导出发生浏览器超时，因此不将截图归档列为验收证据；页面交互与结果通过 DOM 实测。
- 独立审阅及复审：事件引用数量和支持池地址必须与兑换记录一致；缺失引用由 Schema、Service 和 API 反例测试拒绝。没有修改已冻结的 `OnchainEvidence`。

| 案例 | 真实交易 | 读取结果 |
| --- | --- | --- |
| 大额外层转账 | [0x19b457…](https://etherscan.io/tx/0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a) | 20059.2 ETH，区块 20449709，`NO_SUPPORTED_SWAP` |
| 本池卖出 | [0x310948…](https://etherscan.io/tx/0x310948594828e864aff5f1bc133968b80889379ec66091e734a6758bf8abc9e9) | 0.198 WETH → 517.590594 USDC，区块 26138703，日志 12 |
| 本池买入 | [0x6cf0da…](https://etherscan.io/tx/0x6cf0da2d2749fe1f12c8120f03f29fa4b5c4e0964f1117f2787a11c5a6ee25dc) | 259.31045 USDC → 0.099098067895988648 WETH，区块 26138703，日志 1049 |

这些记录只描述本次实际读取和覆盖范围，不能证明地址身份、整个交易的净方向或行情因果。待确认、错链、重组和伪造日志等边界由单元测试覆盖，不宣称本机发生过这些主网异常。
