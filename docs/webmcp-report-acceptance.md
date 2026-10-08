# WebMCP 真实报告验收 · 2026-10-08

本轮实现用户已批准的外部 WebMCP 报告方案。开发测试与实际浏览器测试分别记录，不把受控测试输入当成真实 Agent 成果；代码发布状态以仓库提交历史为准。

## 已实现

- `/report` 用 ETH / 24h 或 7d 作为输入，复用首页与 ETH 详情的公开数据源。网站无内置模型调用、无钱包要求。
- 六工具：create_eth_snapshot、get_eth_snapshot、get_eth_indicator_definitions、get_eth_evidence、submit_eth_report、get_eth_report。使用 document.modelContext.registerTool(tool, { signal })，页面退出立即撤销注册，包括未完成的注册。
- 页面会话只保留一份快照/报告；事实数据不接受模型覆盖；报告引用必须属于当前快照。不同报告不能覆盖已接受结果，相同重复提交幂等。
- A4 / JSON 使用同一结果，支持复制与下载；保留现有主题和原生前端。没有自动生成 PDF。
- 旧 `/api/onchain-analysis` 的 AI 请求 HTTP 410 / AI_MODE_REMOVED，RPC/模型调用前拒绝；RULES 旧合同保留。
- 当前统计只标为工程方法。没有论文来源，不宣称论文背书、综合预测风险或经过验证的因果。

## 新鲜检查

| 检查 | 结果 |
| --- | --- |
| 基线 `pnpm test` | 1050 passed / 6 skipped |
| 完成后 `pnpm test` | 1085 passed / 6 skipped，58 文件通过、2 跳过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm test:http` | 12 页面、静态资源、同源校验、旧 Mock 保护及去重通过；新增 AI 410、非法窗口400、跨来源403 通过 |
| `pnpm test:fingerprint` | 5 项通过（本地内存 EVM，无主网广播） |
| `git diff --check` | 通过 |
| 独立代码审阅 | DEX 缺值被当成0、全站视图事件冲突、未完成注册退出未立即注销，均已修复并补回归；最终复审无新发现，针对性16项通过 |

自动化覆盖：真实来源规范化、数值范围、已收盘/连续 K 线、样本不足/零分母、实际 DEX Adapter 的缺失/部分缺失/真实0/多池合计、HTML转义、数据快照匹配、伪造引用、过期数据限制、并发采集、失败清空、重复提交、注册部分失败/立即退出再返回、完整app点击处理器共存、双视图一致及JSON复制。受控工具注册与模型提交均为测试输入，不作为真实 Agent 的分析成果。

## 真实只读 HTTP 采集

北京时间 **2026-10-08 09:26:01**，临时隔离 Node 服务 `GET /api/eth-report-snapshot?days=1` 返回200/no-store。该服务跳过 `.env*`、使用独立 Mock Guardian journal，未配置 LLM 凭据或 Ethereum RPC；没有操作原生产进程、真实钱包或已有事件。

快照 `ca970009-5957-4710-9242-f235aed6948c`：market、history、orderbook、dex、tvl、sentiment、github 七组 live，news unavailable。缺失新闻保持 null。不同来源时间分别保留；只是单次成功，不证明数据源长期稳定。

证据：[HTTP结果](evidence/2026-10-08-webmcp/http-live-result.json)、[真实快照](evidence/2026-10-08-webmcp/http-live-snapshot.json)。曾有一次隔离HTTP返回503，实测发现DEX最大池聚合函数错误，修复并新增两池回归后上述请求成功；没有在失败时回退数据。

## 用户授权的 computer use 验收

用户随后明确要求“使用computer use 测试”，授权本次浏览器操作与截图；不改变其他任务的视觉验收约束。北京时间 2026-10-08 09:33 起，在独立 `127.0.0.1:3118` 实例和 Ego TaskSpace 6 中测试；未重启原服务，未读写生产 journal、私钥或 `.env*`，没有签名或广播。

浏览器为 Chromium 152，存在原生 `document.modelContext`。Codex 从浏览器外控制页面，通过原生 `getTools` / `executeTool` 调用真实注册工具；没有注入 Mock 注册器或调用网站内置模型。本次没有操作 ChatGPT 桌面应用自身的 Site Tools 客户端 UI，其客户端兼容性仍需现场确认。

| 实际操作 | 结果 |
| --- | --- |
| 六工具发现及调用 | 全部成功；读取指标定义、快照及八组证据，提交和读取报告 |
| 手动准备24h / 工具准备7d | 24 / 168 个已收盘小时样本；七组有效，新闻不可用；提交前报告隐藏 |
| 非当前快照、伪造引用、不可用新闻引用 | 均拒绝；未渲染新报告 |
| 同一提交 / 不同提交 | 同一提交保持 reportId；不同结果不能覆盖已接受报告 |
| A4 / JSON / 复制 / 下载 | 切换与复制成功，下载 JSON 与工具读取的完整报告逐字一致 |
| 375px手机宽度 | A4 和 JSON 文档宽度均375px，纸面宽341.25px，无横向溢出；工具栏换行，长文本可读 |
| 引用跳转及浏览器后退 | 修复后跳到证据，reportId 和内容保持；后退也保持 |
| 采集失败 | 用浏览器阻断本次采集请求作受控故障注入；旧报告和快照清空，明确失败提示；随后解除阻断 |
| 离开 / 重新进入 | 离开后六工具消失；重新进入注册六工具，报告、快照和旧会话均为空 |

24h快照：`d471c97e-6dbc-4072-b840-591904499bc7`，报告：`35fb4280-3010-445d-9248-0d556c892ab4`。7d快照：`507d72d6-c206-4ea9-8643-c650a0a8482d`，报告：`79ae6239-d69e-459a-a9d8-231dcf8da77f`。报告由外部 Codex 基于实际采集数据撰写，结论为数据不足，没有编造异常原因或交易建议。

实测发现并修复一项缺陷：全站 `popstate` 处理器会在证据 fragment 跳转时重建页面，清空报告。现在只有路径或查询参数变化才重建；fragment跳转保留会话。回归在修复前失败、修复后通过，独立增量审阅无可行动问题。随后重新运行全套测试1085 passed / 6 skipped、typecheck、build、隔离HTTP检查及diff检查，全部通过。

该浏览器版本的 `executeTool` 实测要求把参数用 `JSON.stringify` 传入；网站注册的回调仍接收对象。调用方式可参照 [GoogleChromeLabs 示例](https://github.com/GoogleChromeLabs/use-webmcp-tool/blob/main/useWebMCP.mdx)。这属于浏览器调用端差异，网站未加入兼容 shim。

证据：[浏览器结果](evidence/2026-10-08-webmcp/browser-result.json)、[真实工具调用](evidence/2026-10-08-webmcp/browser-native-calls.json)、[24h报告](evidence/2026-10-08-webmcp/browser-report-24h.json)、[7d报告](evidence/2026-10-08-webmcp/browser-report-7d.json)、[会话检查](evidence/2026-10-08-webmcp/browser-lifecycle.json)、[手机A4截图](evidence/2026-10-08-webmcp/browser-mobile-a4.png)、[手机JSON截图](evidence/2026-10-08-webmcp/browser-mobile-json.png)。

当前不能宣称：所有浏览器或外部模型客户端均已兼容、ChatGPT自身Site Tools UI已验收、论文指标已实现、链上异动原因已确认、产品可自动交易或持续监控。新闻来源本次不可用，真实市场数据和外部解释不等于已核实的链上因果证据。

使用说明：[webmcp-reports.md](webmcp-reports.md)。
