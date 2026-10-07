# A/B/C 本地整合验收

2026-10-07，Asia/Shanghai。前半部分是 17:27–17:55 本地候选验收，当时没有 push、修改 main 或更新主工作区。用户随后明确授权“合并”，D 的新鲜整合记录见本文最后一节，不将两轮状态混用。

## 范围与来源

| 部分 | 固定版本 | 纳入内容 |
| --- | --- | --- |
| 基线 | `origin/main` = `7d6ceec` | 已冻结的调查工具与独立 Mock/Fork 保护流程 |
| A | `c57962c` | [真实窗口、三笔交易与来源](demo-cases.md)，原始保存输出保持不变 |
| B | `db3e0f0` | [方法卡](b-deliverables/method-card.md)及[待验证 AI 对照](b-deliverables/ai-benchmark.md)，本地校正证据口径 |
| C | `9b8df50` 中单个文档 | [C 原验收记录](c-acceptance-review.md)，校正 logIndex、时间窗口与同一 RPC 的验证范围 |

worktree：`/Users/miyakostella/.codex/worktrees/abc-local-integration/xjy`。
分支：`codex/integrate-abc-local`。A/B 的本地 merge 无冲突，使用 `--no-commit`，合并仍待提交；C 文档单独引入，未合入 C 的研究父提交。

本候选版相对基线只有 docs 变化。源码、公共合同、依赖、默认 Policy、Executor、HTTP 路由和现有事件状态机内容未改；主工作区的配置及 journal 未复制或删除。

## 整合时修正的证据问题

- B 原对照的 3.5/5.5 分钟和 40 秒为估算，缺完整问题、模型、原始工具返回和制作＋复核计时，不能声明降时、优于通用 AI 或不可替代。现在保留为待验证，不把 AC-006 记为通过。
- B 原示意 JSON 不作为实际输出；改为引用 A 的完整报告。方法卡补了 Confidence 的两位舍入，并按 SELL/BUY/MIXED/无事件/回滚分别说明，避免把所有案例解释为卖出。
- C 的 `logIndex=12/1049` 是区块内全局索引，不是回执第几条；当天历史交易不属于当前 5 分钟窗口。同一 RPC 的两种调用可以核对解析一致性，不是独立数据源验证。
- C 的 HTTP/Mock 记录注明原作者、时间和来源，不能当成本轮集成者的新鲜实测；本轮实际操作另列在下面。

## 未纳入的 C 研究代码

`bbfde9c` 的策略校准、结果文件、抓取脚本及测试保持在 C 原分支，本轮没有复制、修改或运行。

独立只读审阅发现：年度训练按输入日期切分，但未来 10 日标签跨入测试年；研究分数与产品现行 Risk Score 没有映射；模拟器自动买回/再平衡不等于 Guardian 恢复行为；80–90 桶的统计被写成全部大于 80；原始输入没有固定快照。测试内部一致不解除这些研究有效性问题。

因此本次只纳入冻结范围需要的 C 验收记录，没有据研究结论把 minRiskScore 改为 85、添加风险梯度或自动买回。后续研究若继续，需修复标签边界、重跑与验证结果，并清楚区分研究模型和产品。

## 本轮实际检查

| 检查 | 结果与范围 |
| --- | --- |
| 主工作区修改前测试 | 17:27，896 passed / 2 skipped |
| 独立 worktree 基线测试 | 17:30，896 passed / 2 skipped |
| 本地合并后的 typecheck / test / build | 全部 exit 0；测试 896 passed / 2 skipped，两项 Fork 跳过未计为通过 |
| 源码/合同/依赖不变核对 | 相对 `origin/main` 的非 docs 内容没有 diff |
| 保存输出与文档 | A 输出原样引入；本地链接、公开 schema、文件摘要、窗口/数量等校验；独立审阅文档修正 |

### 独立端口 HTTP

生产构建运行在 `http://127.0.0.1:3101`，Guardian 明确为 **MOCK**，固定钱包 `0x1111111111111111111111111111111111111111`。使用该 worktree 新建的 `.guardian/abc-local-integration.sqlite`，保留该测试 journal；未删除或重置主工作区事件。

完整日期记录：[http-checks.json](evidence/2026-10-07-integration/http-checks.json)。记录中的 Guardian txHash 为 Mock，不作为主网证据。HTTP 页面状态不是浏览器交互验收。

| 操作 | 实际结果 |
| --- | --- |
| `GET /`、`GET /investigate` | 200；未使用浏览器点击 |
| 读取/保存 Policy | 200，版本按预期递增 |
| `POST /api/rescue` | 200；Mock Risk 91 / Confidence 0.88；敞口 `100% → 70%`，独立 after，verification `PASSED` |
| 同事件重复执行 | 409 `EVENT_OCCUPIED`；没有第二次兑换 |
| 暂停/恢复 | 同一 activeEvent，事件数保持 1 |
| 停止并重启服务，保留 journal | 同一事件 `857e96a1-0499-430a-bfc2-da547418e5ed`；事件数仍为 1，重复请求仍为 409，保存的 `latestSession.after` 保持不变；未额外重读新余额 |
| 不同钱包 | 403 `WALLET_MISMATCH`，事件数仍为 1 |
| 无效交易哈希 | 400 `INVALID_REQUEST` |
| 有效历史转账的真实 HTTP 查询 | **503 `RPC_READ_FAILED`，约 10 秒超时**；没有产生交易报告、Mock 或旧输出；其余两个真实案例未在本轮 HTTP 继续查询 |

截至这轮 HTTP 检查，真实查询未验收成功。A 在 16:50 的服务读取和 C 的历史 HTTP 记录仍是各自时间点的证据，不能填补本次超时。未增加自动重试、替换 RPC 或降级；后续浏览器查询结果另列在下面，现场在线演示仍依赖配置 RPC 的可用性。

验收服务已停止，测试 journal 保留；本页的 HTTP 状态是当时的实际记录，不表示当前 3101 端口仍在运行。

本轮没有跑 Anvil/Fork、广播链上交易、真实 Agent/LLM、AI 对照或浏览器交互；没有获利/减损、用户采用或商业效果声明。

### 后续 computer use 验收：17:48–17:55

用户要求暂不等 D，实际点击现有 Demo。使用 ego-browser 的一个 TaskSpace，在同一候选 worktree 启动生产服务 `http://127.0.0.1:3101`。Guardian 使用新的 `.guardian/computer-use-demo.sqlite`，此前 HTTP journal 保留未动；真实交易核验仍使用原配置 `https://eth.drpc.org`，没有切换 RPC、自动重试或使用存档填补结果。

| 页面操作 | 实际观察 |
| --- | --- |
| 首页加载 | 明确 MOCK、固定钱包、模拟行情/调查/执行；监控初始为 Paused |
| 点击 `Run rescue loop` | 新事件 `3f088114-80b0-4d2d-8a09-fb257c6b5519`，Risk 91 / Confidence 88%，Policy 批准 30 个百分点减仓，MOCK SWAP，敞口 `100% → 70%`，独立 after 的 8 项验证 PASSED |
| 再次点击 Run | 显示该风险事件已占用执行机会；事件数仍为 1，没有第二次兑换 |
| Start → Pause → 刷新 | 仍为同一事件、事件数 1；Paused，恢复显示保存的已验证 session。这不是刷新时又执行了一次 |
| `/investigate` 空输入、钱包地址 | 空输入禁用提交；钱包地址被拒绝并提示需要完整交易哈希 |
| 填入真实转账示例 | 只填哈希，未自动生成报告；实际点击核验时输入和提交禁用，显示加载状态 |
| 真实转账，查询时间 17:54:27 | 20059.2 ETH、区块 20449709、0 条日志；明确不能把外层转账当作卖出，未发现指定池兑换证据 |
| 真实 SELL，查询时间 17:54:49 | 本池 WETH → USDC；全局 logIndex 12，0.198 WETH / 517.590594 USDC |
| 真实 BUY，查询时间 17:54:52 | 本池 USDC → WETH；全局 logIndex 1049，0.099098067895988648 WETH / 259.31045 USDC |
| 切换 SELL / BUY 哈希 | 提交前已清除旧报告；新报告包含事实、未知项、区块与交易出处，USDC 标为代币数量 |

证据：[Mock 成功页面](evidence/2026-10-07-integration/browser-mock-success.txt)、[重复拦截](evidence/2026-10-07-integration/browser-duplicate-blocked.txt)、[暂停刷新](evidence/2026-10-07-integration/browser-pause-reload.txt)、[无效输入](evidence/2026-10-07-integration/browser-invalid-input.txt)、[真实转账页面](evidence/2026-10-07-integration/browser-live-transfer.txt)、[SELL/BUY 页面摘要](evidence/2026-10-07-integration/browser-live-cases.json)、[SELL 页面](evidence/2026-10-07-integration/browser-live-sell.txt)、[BUY 页面](evidence/2026-10-07-integration/browser-live-buy.txt)。截图：[Mock 结果](evidence/2026-10-07-integration/browser-mock-success.png)、[交易核验页面](evidence/2026-10-07-integration/browser-live-buy.png)、[买入兑换证据](evidence/2026-10-07-integration/browser-live-buy-evidence.png)。

结论：现有 Mock 保护流程与真实只读交易核验均可演示，本次浏览器里的三笔真实查询成功。此前 HTTP 超时仍是有效的稳定性记录，不能承诺现场 RPC 一定可用。没有测试 Fork、真实自主 Agent 或主网自动保护。首页仍以 Guardian 保护流程为入口，D 尚需整理冻结后的报告主线与展示顺序；本次没有修改前端或业务源码。

验收后保留买入报告浏览器页供用户查看，服务继续运行在 3101，监控保持 Paused。该测试事件保持占用，重复 Run 被拦截是预期行为，不删除 journal 来重复演示。

## 结论与交接

可本地整合的候选包是 **A 真实证据＋B 方法说明/待验证对照＋C 验收文档**，保留当前运行流程。整条 C 校准分支尚不适合直接并入冻结版。

本地检查不等于 main 已更新、PR 已创建或比赛已提交。下一步 D 可引用这套材料检查演示，B 补真实对照原始记录；线上 RPC、Fork/Agent 缺口与最终提交分别按实际验收处理。唯一执行状态真源仍为[冲刺计划](loopx/plans/2026-10-07-hackathon-demo-sprint.md)。

## D 整合与发布前复验

18:25–18:46，用户明确要求“合并”。D 来源固定为 `a3f227238011cc0a56b8a40bc87caf0583a8da02`，与已审阅 A/B/C 材料合并并保留提交历史；C `bbfde9c` 研究代码仍未纳入。前端迁移为 `web/` 原生 JS/Vite 与 `server/` 同源服务，保护实验移到 `/guardian`。公共 domain schema、核心 Policy/Executor 和 Guardian 事件状态没有改动。

整合中修复并新增测试：环境优先级保持进程 > `.env.local` > `.env`；报告绑定请求、输入变化清除旧结果；NFT/存证广播前保存占用、未知回执仅查原 hash、存储失败禁止重播；确认 NFT 的元数据与时间从已核验链上 URI 读取。独立审阅提出的问题已顺序修复并复验。

| 新鲜检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 |
| D 合入未修复基线 | 932 passed / 6 skipped |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 18:39、18:48 两次均 969 passed / 6 skipped；46 文件通过、2 文件跳过 |
| 最后源码修改后的 `pnpm build` | 18:42，生产构建 exit 0 |
| `pnpm contract:check` | 固定报告合约产物与源码/编译器一致 |
| `pnpm test:fingerprint` | 5 passed；仅隔离本地 EVM 和计算验证 |
| 最后构建后的 `pnpm test:http` | 11 路径、资源、同源限制、策略版本、不触发跳过、Mock 成功和重复事件拦截通过 |
| 最后构建后的 `pnpm test:sculpture` | 预编译源匹配，8 个生产材质创建成功；不是 GPU 视觉验收 |

六项条件测试跳过未计为通过。本轮没有连接钱包、签名、公开测试网部署/铸造、BOT 主网部署、真实 LLM 或 Anvil/Fork 自动执行。BOT 模块配置为测试网 968，不是赛事提供的主网 677 有效部署证明。

发布前独立复核未发现秘密泄漏、危险默认值或未解决的问题。CI 已补上指纹 `.test.mjs`、生产 HTTP 与 sculpture 检查，避免仅 Vitest 绿色掩盖新增模块回归。

### D 新版 browser 操作

生产服务运行在 `http://127.0.0.1:3101`，新 journal `.guardian/d-unified-merge.sqlite`，此前 journal 与主工作区配置未动。Guardian 明确 MOCK、固定测试钱包、监控暂停；真实只读查询使用 `https://eth.drpc.org`，无存档/Mock 补齐。

| 操作 | 实际观察 |
| --- | --- |
| 首页 | 图鉴与导航可加载，行情标为演示数据 |
| `/guardian` 点击“运行一次保护流程” | Risk 91 / Confidence 88%；Policy 批准 30 个百分点；Mock 3 ETH → 8100 USDC；独立 after 敞口 70%，8 项验证 PASSED |
| 再次运行 | 执行机会已占用，没有第二次兑换 |
| `/investigate` 真实转账，18:39:29 | 20059.2 ETH，区块 20449709，0 日志；明确不是已确认卖出 |
| 改为 `bad` | 旧报告立即清除，提交显示完整交易哈希校验错误 |
| 最后构建后真实 SELL，18:46:18 | logIndex 12；0.198 WETH / 517.590594 USDC；保留钱包净方向、美元价值与因果未知项 |

证据：[Mock 闭环](evidence/2026-10-07-integration/d-browser-guardian.txt)、[重复拦截](evidence/2026-10-07-integration/d-browser-duplicate.txt)、[真实转账](evidence/2026-10-07-integration/d-browser-transfer.txt)、[新版真实 SELL](evidence/2026-10-07-integration/d-browser-sell.txt)、[SELL 页面截图](evidence/2026-10-07-integration/d-browser-sell.png)。指纹 GPU、移动端排版与实际钱包交互未验收。

发布结果：2026-10-07 18:52，[PR #5](https://github.com/cinderharbor7/xjy/pull/5) 合并为 `2f2ed63efa2baa5e7807fe7e561fcbe6935bf797`；[GitHub CI](https://github.com/cinderharbor7/xjy/actions/runs/37610004051) 全部通过。远端 main 包含集成 commit `9f87b8d`，本地主工作区已快进到该 main 并重新安装锁定依赖；18:53 typecheck 与 969 passed / 6 skipped 复验通过。没有 force push 或删除队友分支。比赛提交、需求验证、真实 Agent 与 BOT 主网资格仍是独立未完成事项。
