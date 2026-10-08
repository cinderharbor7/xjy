# ETH WebMCP 调查报告

`/report` 由网站准备 ETH 数据，由外部 Agent 调用页面工具、解释证据并提交报告。网站复用首页的 `market()` 与 ETH 详情的 `detail("ETH", days)` 数据源，不读取首页的演示模式，也不在服务器或页面内调用模型。报告可以切换 A4 阅读版与 JSON 数据版，并复制或下载 JSON。

这条报告路径不需要服务器 LLM 凭据或 Ethereum RPC key；采集的是公开市场与生态接口，不是 RPC 链上交易核验。外部 Agent 的账户、模型和浏览器能力由其宿主应用提供。页面工具不会签名、交易、部署、发布或铸造，也不会授予 Guardian 权限。

## 使用方法

1. 使用项目现有本机服务，在支持 WebMCP 的应用内浏览器打开 `/report`，默认地址为 `http://127.0.0.1:3000/report`。服务启动方式见项目 README；本任务不修改私密配置或生产监控。
2. 页面显示“6 个 WebMCP 工具已注册”时，工具已可供兼容的外部 Agent 发现。这不表示 Agent 已连接或已经开始调查。
3. 选择 24 小时或 7 天，点击“准备真实数据”；也可让 Agent 调用 `create_eth_snapshot`。保存返回的 `snapshotId`，后续读取和提交都使用这次 ID。
4. 让外部 Agent 读取完整快照、指标定义和所需证据组，区分观察、假设、反证与未知项，再调用 `submit_eth_report`。`NO_CLEAR_ANOMALY` 和 `INSUFFICIENT_DATA` 都是有效结论。
5. 接收后切换 A4 / JSON、点击引用查看证据，按需复制或下载 `eth-report-<reportId>.json`。A4 展示网站快照的关键数据、外部分析、引用和指标方法；下载内容包括外部分析、完整来源快照与指标定义。当前没有 PDF 导出功能。

可给外部 Agent 的任务说明：

> 请读取此页的 ETH 快照与指标定义，按需查看各证据组。判断是否存在异动线索，区分事实、原因假设、反证与未知项，使用本次证据 ID 提交报告。保留来源范围和时间，不把新闻标题当作已核实原因，不生成交易指令。

只有当前 `/report` 页面实例的内存保存一个活动快照和一份报告。刷新或离开页面会清空；重新准备数据也会立即清空旧快照和旧报告，即使新采集失败，旧报告也不会保留。相同报告的重复提交返回同一份结果；不同报告不能覆盖已接收的报告，应先创建新快照。其他页面实例不能用旧 ID 访问本页状态。

普通浏览器若没有 `document.modelContext.registerTool`，仍可打开页面并准备数据，但无法通过这些工具接收 Agent 报告；网站没有内置模型替代流程。注册失败时页面明确提示失败。

## 六个页面工具

工具通过 `document.modelContext.registerTool(tool, { signal })` 注册，`inputSchema` 从共享 Zod 合同生成，执行时再次校验。四个读取工具标记 `readOnlyHint: true`；创建快照与提交报告标记为非只读；所有工具标记 `untrustedContentHint: true`。来源文字是数据，不能作为 Agent 指令。

此实现采用 [OpenAI 的 WebMCP 接入方式](https://learn.chatgpt.com/docs/webmcp)和 [2026-10-02 WebMCP 草案](https://webmachinelearning.github.io/webmcp/)中的注册选项：每批注册使用同一个 `AbortController`，页面退出、注册部分失败或会话关闭时 `abort()` 注销该批工具。草案仍是社区草案，工具可用性以宿主浏览器实际支持为准。

| 工具 | 精确输入 | 返回值 | 行为 |
| --- | --- | --- | --- |
| `create_eth_snapshot` | `{ "windowDays": 1 }` 或 `{ "windowDays": 7 }` | `Snapshot` | 调用固定网站采集接口，替换本页快照和报告；不调用模型。 |
| `get_eth_snapshot` | `{ "snapshotId": "<本次 UUID>" }` | `Snapshot` | 读取本页当前快照，不刷新来源。 |
| `get_eth_indicator_definitions` | `{}` | `IndicatorDefinition[]` | 返回下文七项确定性定义，不请求网络。 |
| `get_eth_evidence` | `{ "snapshotId": "<本次 UUID>", "group": "market" }` | `Evidence[]` | 返回当前快照中该组所有证据，包括过期或不可用项；`group` 必须为下文枚举之一。 |
| `submit_eth_report` | `ReportSubmission`，完整示例见下文 | `AcceptedReport` | 校验结构、快照身份与引用后写入页面内存；不证明文本真实性。 |
| `get_eth_report` | `{ "reportId": "<本次报告 UUID>" }` | `AcceptedReport` | 读取本页已接收的报告及其来源快照，不刷新、不推理。 |

所有输入对象都不接受额外字段。UUID 必须是实际 UUID，表中的占位字符串不能直接执行。

### 返回数据形状

`Snapshot` 的字段全部必填：

```ts
type Snapshot = {
  version: 1;
  snapshotId: string; // UUID
  asset: "ETH";
  windowDays: 1 | 7;
  createdAt: string; // ISO UTC datetime
  evidence: Evidence[]; // 8–28 项，id 不重复
  limitations: string[]; // 1–20 项
};
type Evidence = {
  id: string; // 1–100 字符，本次快照内唯一，例如 market-1
  group: "market" | "history" | "orderbook" | "dex"
    | "tvl" | "sentiment" | "news" | "github";
  source: string; // 1–100 字符
  url: string; // HTTP(S) URL，最多 2048 字符
  status: "live" | "stale" | "unavailable";
  collectedAt: string | null; // ISO UTC datetime：来源采集时间
  observedAt: string | null; // ISO UTC datetime：来源观测时间，未知时为 null
  scope: string;
  data: JsonValue; // unavailable 必须为 null；其他状态非 null
};
type IndicatorDefinition = {
  id: string;
  formula: string;
  unit: string;
  limitation: string;
};
```

`live` / `stale` 证据必须有 `collectedAt`。`live` 仅指本批采集时来源有效，不能保证 Agent 读取时仍然新鲜；`stale` 只作历史背景；`unavailable` 保持 `data: null`，不填充 Mock。各来源时间独立，`createdAt` 是采集批次时间，不是同一时刻或同一区块快照。`scope`、`limitations` 以及下文报告文本均先去首尾空白，再要求 1–2000 字符。

`ReportSubmission` 的字段全部必填；`observations`、`hypotheses`、`nextChecks` 可以是空数组：

```ts
type ReportSubmission = {
  snapshotId: string; // 本页活动快照的 UUID
  conclusion: "ANOMALY_SIGNALS" | "NO_CLEAR_ANOMALY" | "INSUFFICIENT_DATA";
  summary: string;
  observations: { // 最多 12 项
    statement: string;
    basis: "CURRENT" | "HISTORICAL";
    evidenceIds: string[]; // 1–12 个本次证据 ID
  }[];
  hypotheses: { // 最多 6 项
    explanation: string;
    supportingEvidenceIds: string[]; // 1–12 个本次证据 ID
    counterEvidenceIds: string[]; // 0–12 个本次证据 ID
    uncertainty: string;
  }[];
  uncertainties: string[]; // 1–12 项
  nextChecks: string[]; // 最多 8 项
};
type AcceptedReport = {
  version: 1;
  reportId: string; // UUID
  acceptedAt: string; // ISO UTC datetime
  origin: "EXTERNAL_AGENT";
  validation: "STRUCTURE_AND_REFERENCES_ONLY";
  analysis: ReportSubmission;
  snapshot: Snapshot;
  indicatorDefinitions: IndicatorDefinition[]; // 接收时复制的七项方法定义
};
```

报告和其中的观察、假设对象都拒绝额外字段。证据 ID 为 1–100 字符。所有支持引用与反证引用必须存在于本次快照，且不能为 `unavailable`；`CURRENT` 观察只能引用 `live`。除 `INSUFFICIENT_DATA` 外，结论至少需要一项 `CURRENT` 观察。网站校验这些条件，不检查 Agent 的论证是否成立或因果是否真实。

### 完整提交 JSON 示例

以下展示 `submit_eth_report` 的全部输入字段，不是本次行情结论。执行前将 `<本次snapshotId>` 替换为真实 UUID，并确认当前快照中 `market-1` 为 `live`、`history-1` 可用；若条件不满足，应依据实际证据删改观察，不能照抄引用。示例选择“数据不足”，因为这些证据本身不能确认异动原因。

```json
{
  "snapshotId": "<本次snapshotId>",
  "conclusion": "INSUFFICIENT_DATA",
  "summary": "现有快照提供单交易所 ETH/USDT 行情与小时收盘价背景，但不足以确认 ETH 异动的原因。",
  "observations": [
    {
      "statement": "本次市场证据来自 Binance Spot ETH/USDT 滚动 24h 数据，范围是单交易所现货。",
      "basis": "CURRENT",
      "evidenceIds": ["market-1"]
    },
    {
      "statement": "历史组包含实际返回的已收盘小时样本；应按首末时间解释窗口，不能把小时收盘价回撤等同于小时内最大回撤。",
      "basis": "HISTORICAL",
      "evidenceIds": ["history-1"]
    }
  ],
  "hypotheses": [
    {
      "explanation": "若需要解释市场变化，应进一步区分交易所现货活动与链上事件；当前价格及小时样本不能单独建立因果。",
      "supportingEvidenceIds": ["market-1", "history-1"],
      "counterEvidenceIds": [],
      "uncertainty": "这是一项待核查方向，没有引用反证不代表不存在反证，也没有证明某个事件造成价格变化。"
    }
  ],
  "uncertainties": [
    "不同来源不是同一时刻或同一区块观察。",
    "当前快照没有直接核验的链上交易；无法确认身份、资金流向或异动原因。"
  ],
  "nextChecks": [
    "先检查各来源的状态、采集时间与实际窗口，再补充与观察时段对应的原始事件证据。"
  ]
}
```

接收结果为上文 `AcceptedReport`，其中 `analysis` 为已校验的提交对象，`snapshot` 保留本次数据，`indicatorDefinitions` 固定接收时的方法定义。随后使用返回的 `reportId` 调用 `get_eth_report`。

### 失败与并发边界

输入不符合共享合同会抛出 Zod 校验错误；页面工具失败表现为调用拒绝，不返回一份伪成功报告。会话错误包括 `SESSION_CLOSED`、`SNAPSHOT_BUSY`、`SNAPSHOT_MISMATCH`、`WINDOW_MISMATCH`、`REPORT_NOT_FOUND`、`REPORT_ALREADY_SUBMITTED`、`INVALID_EVIDENCE_REFERENCE` 和 `CURRENT_EVIDENCE_REQUIRED`。未知工具名拒绝为 `UNKNOWN_TOOL`。

一次只允许一项采集。采集期间可以读取确定性的指标定义，其他快照/报告读取和提交会拒绝；采集失败后本页没有活动快照。页面“实际工具调用记录”显示调用开始、完成或失败，最多保留最近 60 条阶段记录；这不等于外部 Agent 已完成调查。

## 来源与指标边界

| 证据组 / 常见 ID | 数据内容 | 必须保留的范围 |
| --- | --- | --- |
| `market` / `market-1` | Binance ETH 的 `price`、`change`、`volume`、`high`、`low`、`trades`、`amplitude`；其他注册资产的价格/涨跌/成交额比较 | 单交易所滚动 24h；报价为 USDT，不是 USD；其他币种只作市场背景。 |
| `history` / `history-1` | 已收盘 1h 样本的 `time`、`close`、`volume`、`buyVolume`，`sampleCount`、`volatility`、`drawdown`、`buyRatio` | 以实际首末时间为准，样本必须连续且已收盘；成交额为报价资产。 |
| `orderbook` / `orderbook-1` | `bestBid`、`bestAsk`、`spread`、`bidDepth`、`askDepth`、`imbalance` | Binance 返回 100 档以内、中间价 ±1% 深度，不是完整盘口。 |
| `dex` / `dex-1` | DEX Screener 返回池的 `pools`、`liquidity`、`largest`、`buys`、`sells` | 只选 WETH 为 baseToken 的返回池；任一池缺少某项指标时，该项聚合值保持 null，真实 0 保留。不是全网或原生 ETH；买卖笔数不是净卖出额，无历史不能称流动性下降。 |
| `tvl` / `tvl-1` | DefiLlama 的 Ethereum `tvlUsd` | 链级静态 TVL，不是协议 TVL、流入额或流出额。 |
| `sentiment` / `sentiment-1` | Alternative.me 恐惧贪婪指数 `value` | 全市场背景，不是 ETH 专属情绪或预测。 |
| `github` / `github-1` | `ethereum/go-ethereum` 的 `stars`、`forks`、`issues`、`pushedAt` | 仓库背景；推送时间不等于最后提交，Stars 不是安全评分。 |
| `news` / `news-1` 等 | GDELT 返回新闻的 `title`、`domain`、`indexedAt` 与链接；无返回时可能为 `{ "articles": [] }`，来源不可用时为 `null` | 最多 20 条，新闻搜索固定最近 24h，即使选择 7 天；只有标题与收录时间，没有正文，不能证明原因。无返回不证明无事件。 |

`get_eth_indicator_definitions` 返回七项定义，字段为 `id`、`formula`、`unit`、`limitation`：

| ID | 实际计算 |
| --- | --- |
| `market` | `change` 取 Binance `priceChangePercent`；振幅 `(high - low) / open * 100`。 |
| `volatility` | 小时对数收益率的总体标准差乘 `sqrt(24) * 100`，为日化百分比；不足两个收盘价为 `null`。 |
| `drawdown` | 小时收盘价相对此前最高收盘价的最大跌幅百分比，不包含小时内回撤。 |
| `buyRatio` | `sum(takerBuyQuoteVolume) / sum(quoteVolume)`；成交额为零返回 `null`。 |
| `orderbook` | `spread = (ask - bid) / mid * 100`；深度为 ±1% 内 `sum(price * quantity)`；不平衡为 `(bidDepth - askDepth) / (bidDepth + askDepth)`，分母零返回 `null`。 |
| `dex` | 返回的 WETH baseToken 池数量及 USD 流动性合计。 |
| `context` | 保留各提供商的独立观察，不合成风险分数。 |

这些是工程统计和来源观察。用户尚未提供具体论文，论文方法与核实工作延后；页面不声称已采用论文指标、已验证预测能力或已确认异动因果。

## HTTP 采集接口

新增 `GET /api/eth-report-snapshot?days=1|7`，返回与工具一致的 `Snapshot`，响应设置 `Cache-Control: no-store`。服务端先执行本机请求校验：仅允许配置端口/协议下的 loopback 地址及相符 Host；若存在 Origin，须与当前页面同源，跨站请求被拒绝。Agent 不控制来源 URL、凭据或服务器配置。

查询字符串必须恰有一个 `days` 参数，值为字符串 `1` 或 `7`；缺失、重复或附加参数返回 `400 INVALID_WINDOW`。本机/来源校验失败返回 `403 LOCAL_ONLY` 或 `403 ORIGIN_REJECTED`。来源数据未通过验证则返回 `503 SNAPSHOT_UNAVAILABLE`，不生成快照，也不自动重试；非 GET 方法返回 `405`、`Allow: GET`。

`400` / `403` / `503` 错误响应为 `application/problem+json`，字段为 `type`、`title`、`status`、`code`、`detail`；`405` 为普通 JSON `{ "error": "Method not allowed" }`。个别证据不可用仍可返回有效快照，是否足以形成结论由外部 Agent 明确说明；它不等同于整个采集接口失败。

以下是单接口的 OpenAPI 3.1 摘要，完整响应约束以共享 Zod 合同与上文形状为准。项目没有现成的 OpenAPI validator；此 YAML 未经过 OpenAPI 工具验证。

```yaml
openapi: 3.1.0
info:
  title: ETH report snapshot
  version: 1.0.0
paths:
  /api/eth-report-snapshot:
    get:
      operationId: getEthReportSnapshot
      description: 本机同源公开数据采集；只接受一个 days 查询参数。
      parameters:
        - in: query
          name: days
          required: true
          schema:
            type: string
            enum: ['1', '7']
      responses:
        '200':
          description: Snapshot，结构见共享 Zod 合同。
          headers:
            Cache-Control:
              schema: { type: string, const: no-store }
          content:
            application/json:
              schema:
                type: object
                required: [version, snapshotId, asset, windowDays, createdAt, evidence, limitations]
                additionalProperties: false
                properties:
                  version: { type: integer, const: 1 }
                  snapshotId: { type: string, format: uuid }
                  asset: { type: string, const: ETH }
                  windowDays: { type: integer, enum: [1, 7] }
                  createdAt: { type: string, format: date-time }
                  evidence:
                    type: array
                    minItems: 8
                    maxItems: 28
                    items: { type: object, description: Evidence，字段与状态约束见上文。 }
                  limitations:
                    type: array
                    minItems: 1
                    maxItems: 20
                    items: { type: string, minLength: 1, maxLength: 2000 }
        '400': { description: INVALID_WINDOW }
        '403': { description: LOCAL_ONLY 或 ORIGIN_REJECTED }
        '405': { description: Method not allowed；Allow 为 GET }
        '503': { description: SNAPSHOT_UNAVAILABLE }
```

旧 `POST /api/onchain-analysis` 保留独立的链上只读合同：`investigationMode: "RULES"` 仍走原 RPC 核验；`investigationMode: "AI"` 返回 `410 AI_MODE_REMOVED`，提示改用 `/report` 的外部 Agent。旧 RULES 路径的 RPC 配置要求没有变，不应和此处不需要 RPC key 的市场采集合并描述。

## 当前验证范围

自动化验证覆盖工具注册与 AbortSignal 注销、会话生命周期、严格输入及证据引用、同源本机接口和页面报告功能。2026-10-08用户明确授权computer use后，Chromium152原生六工具、真实24h/7d数据、外部Codex报告提交、A4/JSON及375px手机显示已实测；未注入Mock注册器。ChatGPT自身Site Tools客户端UI兼容仍未验证。最新命令结果、截图及来源实测见 [验收记录](webmcp-report-acceptance.md)。
