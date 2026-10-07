# 真实只读异动报告

入口 `/report`；接口 `POST /api/onchain-analysis`。旧 `/api/eth-risk` 和 `/risk-lab` 保持研究样本合同，Guardian 保持独立实验。

请求必须为严格 JSON：

```json
{"wallet":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","investigationMode":"RULES"}
```

`investigationMode` 可省略，默认 RULES。AI 必须显式选择，不接受客户端密钥、RPC URL、模型 URL、任意文本或执行动作。接口仅本机同源访问，不要求连接钱包。调用无写入/执行副作用，不需要交易幂等键，不自动重试；UI 限制一次请求，不新增公开部署/限流能力。

响应是既有 A→B 完整分析加上 `investigationMode` 和 `checkedAt`。呈现合同位于 `src/integration/onchain-report.contracts.ts`，领域 DTO 不变。Portfolio、Market、Signal 共享锚点区块时间；HTTP 再检查钱包和模式绑定。响应 `Cache-Control: no-store`，`X-Onchain-Mode: LIVE_READ_ONLY`。

实际范围：原生 ETH + USDC 持仓、Chainlink ETH/USD 及 USDC/USD、Ethereum Uniswap V3 WETH/USDC 0.05% 单池。信号比较当前五分钟与紧邻前五分钟的总卖出额，基线必须正数。ETH 持仓不含 WETH；池内 WETH 仅归一化为 ETH 卖压统计。行情变化由历史 Chainlink 报价计算，价格更新间隔可能使变化为零。Risk Score 是未校准规则；波动代理不是统计波动率；Confidence 不是未来跌价概率。

## AI 配置和数据发送

用户暂未提供凭据。仅将密钥写入被 Git 忽略的本地 `.env.local`：

```dotenv
ETHEREUM_RPC_URL=https://your-mainnet-rpc
LLM_API_KEY=
LLM_API_URL=
LLM_MODEL=
LLM_THINKING_MODE=
```

API URL 必须是适用的 OpenAI-compatible chat completions 完整地址，模型需支持当前 adapter 的 JSON object 输出及请求参数；兼容性需实际验收。URL/model 未填写时沿用现有 Adapter 默认值。`LLM_THINKING_MODE` 只接受 enabled/disabled；留空不发送该参数，供支持它的服务显式配置。当前本地 DeepSeek 使用 `https://api.deepseek.com/chat/completions`、`deepseek-flash`、`disabled`：已观察到默认思考占满输出额度导致 JSON 截断，关闭后真实模型验收通过。中文简报和少量引用是提示词要求，不保证模型语义正确；引用仍原样校验。重启服务器加载配置，再选择 AI。KEY 不发往浏览器、不写入报告、不提交 Git。模型会收到公开钱包持仓、行情、风险数值、单池信号及证据目录；不会收到私钥。

AI 只解释已提供观察，不能修改 Risk Score 或批准交易。引用必须来自输入证据目录；未知引用、格式错误、空引用或网络失败明确失败。模型解释标记“未经独立核实”，保留既有未知项，Confidence 上限由证据覆盖限定。引用成员校验不证明因果或语义正确。本实现是一次固定读侧＋模型解释，不能称作自主调查、动态工具选择或完整实时自动保护。

## 失败

problem JSON 字段为 `type/title/status/code/detail/instance`，固定安全文案，不输出节点/模型的原始异常、URL、body 或凭据。

| HTTP | code |
| --- | --- |
| 400 | INVALID_REQUEST、INVALID_WALLET、INVALID_ARGUMENT |
| 403 | LOCAL_ONLY、ORIGIN_REJECTED |
| 415 | JSON_REQUIRED |
| 503 | CONFIGURATION_ERROR、UNSUPPORTED_NETWORK、INVALID_CHAIN_DATA、STALE_PRICE、REORG_DETECTED、EMPTY_BASELINE、RPC_READ_FAILED、AI_CONFIGURATION_REQUIRED、AI_REQUEST_FAILED、AI_OUTPUT_INVALID |

失败不返回旧报告、Mock 或隐式规则结果。配置错误必须修正后由人重新查询。基线为零时不制造 Infinity 或“极端异常”。读侧历史定位从 anchor 指数括界后二分，仍核验目标前后的实际时间；没有出块时间假设或备用 RPC。

## 验收

离线测试覆盖有效低风险报告、非法输入、同源、错误钱包/模式/快照、缺配置先拒绝、AI 成功/输出坏/请求失败/证据不足、Confidence 上限，以及页面清空旧结果、防重复、卸载后不回写、HTML 转义。离线保存数据和受控模型响应都不能算在线验收。

真实验收须保存区块、观察时间、窗口、金额、交易出处和实际成功输出；不要求高分。配置后还须单独记录真实模型调用的正常、证据不足、失败三类。API 文档见 [OpenAPI](onchain-analysis.openapi.json)；本仓库没有完整 OpenAPI validator，仅作 JSON/合同结构检查，不冒称规范验证通过。
