# 真实报告候选版验收 · 2026-10-07

分支 `codex/real-investigation-report`，基于 main `9039c20`。本记录先于分支发布；实际发布状态以 GitHub 为准，不代表 main 已合并。冻结范围见 D-012，执行状态见 P-009–011。模型凭据已配置，历史快照/受控边界的真实 DeepSeek 实测见下方更新；已向用户请求支持所需历史数据的专用 RPC。

## 已完成并有证据

- 基线 `pnpm test`：998 passed / 6 skipped。
- 修改后 `pnpm typecheck`、`pnpm test`、`pnpm build` 通过：1041 passed / 6 skipped；报告新增受控测试42项、区块括界新增1项。已有跳过测试未计通过。
- `pnpm test:http`：12 个页面/静态资产、本机同源保护、Policy 版本、Mock 执行、独立验证、重复事件拦截通过。新路由存在不等于该脚本完成真实 RPC。
- `pnpm test:fingerprint`：5 passed；`git diff --check` 通过。
- OpenAPI JSON 与当前 Zod 生成的请求/响应结构一致；无完整 OpenAPI validator，不声称规范全量验证。
- 独立只读安全审阅未发现重要代码问题；授权状态文档矛盾已修正。规则默认、旧 API、领域 schema、Guardian 持久状态及执行范围不变。

## 真实在线输出与失败

| 记录 | 结果 | 证据 |
| --- | --- | --- |
| 优化后完整 CLI | 成功；block 26141022，windowEnd 14:11:47Z，ratio 0.4960136307，Risk20，Confidence0.72 | [历史 CLI JSON](evidence/2026-10-07-real-report/historical-cli-report.json) |
| 新 API 完整 HTTP | HTTP200；block26141090，windowEnd14:25:23Z，checkedAt14:26:11.502Z，ratio0.0204081636，Risk20，Confidence0.69 | [HTTP JSON](evidence/2026-10-07-real-report/http-live-report.json) |
| dRPC 读取诊断 | 历史 getBlock 返回 code15 限流；安全日志无凭据/原始错误 | [限流记录](evidence/2026-10-07-real-report/rpc-rate-limit.json) |
| 其他完整读取和新页面 Live | 同轮仍出现 RPC_READ_FAILED，旧结果保持空，不算在线稳定性通过 | 本地 `/tmp/xjy-*` 日志及失败验收录像 |
| PublicNode | 最近历史 Chainlink 合约读取返回 -32000；不能据此作为已验证备用节点 | 本地 `/tmp/xjy-publicnode-steps.jsonl`，未写入自动切换 |
| 实际 AI 页面 | 选择 AI 后 AI_CONFIGURATION_REQUIRED，未执行 RPC/模型调查，也未生成规则结果 | 本轮 browser TaskSpace4 实测；真实外部模型未运行 |

UTC 表格时间换算为北京时间需 +8h。CLI `checkedAt` 使用采集文件完成时间；该 JSON 是历史记录，不冒称新 API 当时已生成。一次成功不证明公共节点稳定；低风险/非异常结果按实际展示。

## 浏览器与演示备份

实际 browser TaskSpace4：新 `/report` 可以输入钱包、选择模式、发起调用；公共 RPC 失败、缺 AI 配置均明确显示且不残留旧报告。完整成功页面的在线 browser 流程未通过，不用离线 DOM 测试替代。保存的真实 CLI 观察生成独立静态 HTML，浏览器检查了事实、规则、解释、未知项、引用及历史标签。

本地产物均在 Git 忽略的 `output/real-report-evidence/`：

- `historical-report.html`：独立历史备份，顶部明确“非当前在线查询、未调用AI”；手动打开，不做接口失败fallback。
- `historical-report-backup.mp4`：约18.08秒真实浏览器历史报告滚动录制，H.264 970×900，无配音；不能称完整两分钟在线主线。
- `rpc-failure-acceptance.mp4`：约30.4秒新页面 RPC 失败路径真实录制，H.264 970×900。
- `historical-backup.png`、`historical-browser.txt`、完整 JSON 与帧时间戳；录像用 CDP screencast 实际帧和原时间间隔编码，未替换数据。

两段视频已通过 ffprobe 元数据及 ffmpeg 全片解码检查；这不是用户设备上的播放器兼容性或声音验收。讲稿和演示步骤见[演示手册](demo-runbook.md)。

## 尚未通过，继续收尾

1. 专用 RPC 配置后重跑完整报告与浏览器成功路径，确认失败原因解决；保留历史失败记录。
2. 用户模型凭据/服务选择后，实际 AI 正常、证据不足与失败三类验收；调用兼容、中文解释和引用边界需实测。
3. 完整主线录屏及材料核查；目前只有历史/失败片段，不能标视频全部完成。
4. 用户明确 Git 发布授权后提交、push、PR、合并、CI及本地同步。
5. 正式比赛提交材料清单与成功回执；当前尚未操作，BOT部署/主网交易不在本轮。

目标保持未完成。不能把候选版代码、一次HTTP成功或文档存在当作所有 TODO 已收尾。

## DeepSeek 后续实测 · 北京时间 2026-10-07 22:58

用户已提供本地凭据，配置仅保存于被 Git 忽略的 `.env.local`，不保存于公开证据。真实 `/models` 返回 HTTP200，支持 `deepseek-flash` 和 `deepseek-v4-pro`；本次选择 flash。默认思考模式曾在证据不足输入出现 `finish_reason=length`，1500 输出 tokens 中 1279 为 reasoning，截断 JSON 被正确拒绝。新增显式可选 thinking mode（缺省请求不变），本地设 disabled；提示词要求中文简报。

- [保存真实快照 + 真实 DeepSeek](evidence/2026-10-07-real-report/deepseek-historical-normal.json)：HTTP200，完整 JSON、原目录引用通过，中文 summary，Confidence0.35；输入为已保存的历史 HTTP 快照，不是新的实时 RPC。
- [受控证据不足输入 + 真实 DeepSeek](evidence/2026-10-07-real-report/deepseek-controlled-evidence-poor.json)：移除历史快照证据并调整计数，明确是人为构造的边界输入；输出通过，Confidence0.03，保留未知项，不声称真实窗口观测到了稀疏事件。
- [受控无效凭据 + 真实端点](evidence/2026-10-07-real-report/deepseek-failure.json)：HTTP401 → AI_REQUEST_FAILED，未生成规则报告。不是生产凭据失效的现场记录。

新配置测试先观察预期失败后修复；新增两项回归，完整测试1043 passed / 6 skipped，typecheck/build通过。只读独立安全审阅无重要发现；三条引用是简报提示，不改公共合同，不作硬性数量保证。真实模型回答仍可能错误，不能凭一次成功声称稳定性、调查效果或自主 Agent 已验证。

## 同轮完整实时接线成功 · 北京时间 23:00

模型配置后在3102隔离预览，真实 RPC→AI→HTTP 返回200，区块26141257，报告完成时间14:59:51.812Z，Risk21/Confidence0.35，见[完整AI HTTP报告](evidence/2026-10-07-real-report/deepseek-http-live-report.json)。随后在原 browser TaskSpace4 页面输入钱包、显式选择AI、点击生成，页面实际完成：区块26141263，完成时间15:00:50Z，Risk20/Confidence0.35，中文解释、未知项和链上引用可见；[浏览器显示JSON](evidence/2026-10-07-real-report/deepseek-browser-live-report.json)重新通过公共响应schema。未执行交易，原3101状态未改，本轮3102 journal保留。

这是各一次完整成功，补足之前未通过的成功页面路径；保留历史失败证据，不声称公共RPC稳定性已经通过。完整主线录像、发布确认、CI/main同步与比赛提交回执仍未完成。
