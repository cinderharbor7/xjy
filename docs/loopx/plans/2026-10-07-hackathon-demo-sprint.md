---
source: docs/loopx/design/2026-10-07-hackathon-freeze/需求设计文档.md
status: ready
slices:
  - id: P-001
    status: pending
    depends: []
  - id: P-002
    status: in_progress
    depends: []
  - id: P-003
    status: pending
    depends: [P-001, P-002]
  - id: P-004
    status: pending
    depends: [P-003]
  - id: P-005
    status: done
    depends: []
  - id: P-006
    status: done
    depends: [P-005]
  - id: P-007
    status: done
    depends: []
  - id: P-008
    status: done
    depends: [P-007]
  - id: P-009
    status: in_progress
    depends: [P-008]
  - id: P-010
    status: done
    depends: [P-009]
  - id: P-011
    status: in_progress
    depends: [P-009, P-010]
---

# Hackathon 冻结方案执行交接

## Goal And Boundaries

产品口径、范围与验收真源：[比赛冻结方案](../design/2026-10-07-hackathon-freeze/需求设计文档.md)。本计划替换此前“新手交易解释”的冲刺口径，保留 P-001–004 的稳定编号与依赖。frontmatter 是执行状态真源；当前材料、认领、对照与提交仍待完成，不能把方案写好当成团队已经执行。

作品固定为 **可复查的 Ethereum 异动调查原型，附受限保护执行实验**。候选任务是承担 ETH 线索核验的投研/运营人员，交付有出处的事实、解释和未知项；使用者、采用与付费仍是假设。保持 ABCD 的技术归属，共享材料由 D 顺序整合。

展示两条既有真实读侧：A→B 的单次量化观察及独立交易核验；Guardian Mock/Fork 为独立应用实验。真实确定性量化已经存在，真实 AI/Agent 调查尚未交付；既有启发式分数不是预测概率，真实信号也尚未贯通持续交易监控。材料不能把三段拼成已完成的自主保护闭环。

本计划只安排现有入口的检查、案例证据、方法说明、AI 对照、材料与排练，不授予源码/API/合同/事件状态修改、模型接入、主网部署、Git 发布或外部消息权限。`ready` 仅表示已批准的原型提交准备可执行，不表示商业或完整 Agent 能力通过。新增能力需用户另行明确授权与验收，随后更新冻结文件。

2026-10-07 用户另行授权“先看能不能在本地整合”。P-005 记录这次本地候选版与验证，沿用其余 P-* 编号，不扩大软件功能、签名或发布权限。

2026-10-07 用户查看 D 的 `codex/unified-vanilla-fingerprints` 后明确要求“合并”。P-006 记录这一新授权：保留 A/B/C 候选材料，整合 D 已提交的原生前端、同源 Node 服务、指纹与 BOT 测试网存证模块，经新鲜验收后通过 PR 合入 main。此前仅本地整合的权限边界是当时记录；本次允许必要的整合修复、commit/push/PR merge，不授权实际钱包签名、合约部署、NFT 铸造或主网交易。既有用户 computer use 验收请求继续适用于整合后的页面，不把 D 的 DOM 测试当作浏览器验收。

## P-001 一致的比赛场景与表达

D 与队长统一 PPT、讲稿和提交说明。每个人能在 30 秒说出：谁使用、什么情况下使用、输入什么、得到什么，以及哪些是需求假设。公开误读案例说明核验工作发生过，不证明我们已找到客户；导师反馈检查专业性与表达，不当作用户采用。

材料分别标明真实量化、真实交易核验、规则解释、历史实测和 Mock/Fork 实验。不能声称减少了多少损失、超过通用 AI、真实 Agent 已完成或主网自动交易可用。原技术目录和历史验收保留，已有首页无需改版。

> writes: `比赛 PPT / 提交说明 / 讲稿`（D 统一写入）
> anchors: `AC-001/008; D-001/007; TC-001`
> verify: `四人复述同一任务；逐页核对能力模式、证据与实际入口；需求假设和 Agent 缺口明确`
> review: `材料是否把规则报告称为真实 Agent，或把分段实验说成已贯通真实自动保护`

## P-002 可信案例与可复现证据

A 提供当前可读的真实窗口与至少两笔支持范围内的交易。C 顺序复核窗口、基线、倍数、金额、方向、区块、出处和失败情况。真实观察不要求出现异常或固定 Risk 91；窗口与历史交易不同日期时必须分开解释，不能声称当前指标预判了历史事件。

案例范围和既有证据见 [交易核验记录](../../transaction-check.md) 与 [团队集成验收](../../team-integration-acceptance.md)。在线失败如实报错；录屏/保存输出只作标明日期和模式的历史记录，不冒充在线成功。不把单笔 USDC 数量当作美元金额，不把单池无卖出当成全链无卖出。

2026-10-07 A 的新鲜主网读取与案例输出已整理到 [A → B / D 交付](../../demo-cases.md)：16:49—16:50 的共同窗口及三笔重新核验的交易。当前窗口比值为 0.0258，未制造异常。原始 JSON、采集时间和来源 commit 已保存。这是 A 16:53 交付时的记录；其后引入的 C 记录和本地 HTTP 复核见 P-005 与[本地验收](../../local-integration-acceptance.md)，Fork/浏览器仍未记为通过。

C 同时复核独立保护实验：实际选择 Mock 或本机 Fork，Policy 门控、独立 after、重复事件拒绝及未知回执不重播。不删除 journal 或绕过去重；没有跑过的模式不记为通过。Fork 仅按既有许可和配置执行，不扩大钱包或交易范围。本 slice 整理验收证据；发现源码问题先记录，不隐含授予修改权限。

> writes: `docs/demo-cases.md`（A 主写，C 顺序复核，如需独立案例卡）, `公开核验输出 / 验收记录 / 录屏`
> anchors: `AC-002/003/004/007; D-002/004/005/006; TC-002/003/004`
> verify: `pnpm data:analyze --wallet ADDRESS --json；现有 HTTP/浏览器查询；按 docs/guardian-monitor.md 验收实际选用模式；记录失败和未运行项`
> review: `单池不升格为全市场；USDC 数量不冒称美元；Mock/Fork hash 不作为主网证据；无密钥泄露`

## P-003 可复查的调查演示与 AI 对照

B 整理方法卡与每个结论的事实、解释、未知项，C 复核，D 整合演示。使用现有入口，不添加案例按钮、改业务说明代码或接模型。

选择至少两个支持范围内、对测试者不熟悉的案例，使用同题和相同观察时限，对照“通用 AI＋正常可用工具”与“项目现有工具＋必要人工”。尽量由两名非主要实现者交叉分配案例与方法，避免同一人重复做同一题；如做不到，记录熟悉度、顺序与工具偏差。不能刻意限制通用 AI 的工具，也不能抹去它覆盖范围更广的结果。

先记录正确性、遗漏和证据范围，再记录制作加复核的总耗时；保留原始输入、输出和人工步骤。没有改善就如实记录，不包装为优势。内部对照不是客户采用/付费验证，人工使用 AI 也不算项目软件已有 Agent。

真实 Agent 新实现是 **deferred-with-rationale**：本轮未获模型接入授权，也没有其验收范围。披露赛道结合度/创新性缺口，不能通过命名、模板、动画或角色分工消除。后续要改变该状态，须有实际运行记录及“拿掉 Agent 会少什么”的证据。

两分钟主线：核验问题 → 真实量化和方法 → 独立交易证据 → 未知项与实测对照。受限执行实验只作可选附录。量化窗口与历史交易不同事件时，当场说明，不能拼成同一事件的自动链路。

> writes: `方法卡 / AI 对照记录`（B 主写）, `演示讲稿 / 录屏`（D 顺序整合）
> anchors: `AC-005/006; D-003/005; TC-005; 实际 Agent 新实现 deferred-with-rationale：须新增明确授权和验收，当前是公开缺口`
> verify: `两份方法输出与来源可复查；对照原始记录完整；两分钟完整演示；无未测增益/伪装 Agent`
> review: `熟悉案例/工具造成的偏差是否注明；项目单池覆盖比通用 AI 少的事实是否保留`

## P-004 可提交材料与最终核查

队长负责实际提交和回执，D 统一材料和录屏，C 最终复核，A/B 核对数据与方法。README 顶部引用冻结真源，历史实现和验收不删除；所有展示口径与实际入口一致。

验收包括视频可播放、链接可打开、运行步骤可复现、按正式清单提交并确认成功回执。冻结时分支尚未 commit/push；后续用户已明确要求 push/pull，发布状态按实际 Git 结果记录，不代表比赛提交或合入 main。若仅本机运行，如实说明。历史工程验收不冒充本轮现场检查，未运行/跳过项分别列出。

BOT 是独立事项：现有未集成分支与主网部署未验收，Gas 申请和测试网不算有效主网部署。资格及材料按完整规则和主办方确认；本计划不授权部署，不为它扩大主线。

> writes: `比赛提交材料 / 视频`, `README.md`（仅已批准口径）, `本计划 frontmatter`
> anchors: `AC-001/008; D-001/007; TC-006`
> verify: `pnpm typecheck；pnpm test；pnpm build；实际提交清单、视频/链接/运行说明、成功回执；检查命令和未运行项分别记录`
> review: `最终材料不承诺未经验证的客户、收益、因果、Agent 或主网部署`

## P-005 A/B/C 本地整合候选版

在独立 worktree，以 `origin/main` 的 `7d6ceec` 为基线，整合 A `c57962c` 与 B `db3e0f0`；从 C `9b8df50` 只引入验收文档。用户授权本地整合，本轮不提交新 commit、不 push、不改变 main 或主工作区。

C 的父提交 `bbfde9c` 校准研究不纳入冻结候选版：它使用与现行 Risk Score 不同的分数、含跨年度标签窗口，并模拟产品没有的自动买回，尚不能支撑调整默认策略。研究原分支保持不变，本轮不修复或重新运行该研究。

本地只校正文档证据问题：B 的估算耗时与未附原始记录的搜索不能称为已验证优势；示意报告改为引用 A 完整 JSON，AI 对照维持待验证。C 的 logIndex 与历史交易时间口径按链上事实修正，同一 RPC 的两种调用不称为独立数据源验证。公共源码、Schema、依赖、Policy/Executor、事件存储保持基线内容。

完成条件为：本地候选版无合并冲突，文档链接及保存 JSON 与合同一致，typecheck/test/build 通过；真实 AI 对照、Fork、最终提交仍不计完成。HTTP 实测只在独立工作区/端口、Mock 模式和新 journal 上运行，不能更改主工作区配置或旧状态。

本次实际结果见[本地整合验收](../../local-integration-acceptance.md)：技术检查与 Mock HTTP 通过，真实交易 HTTP 返回 `RPC_READ_FAILED` 未计成功；两名独立审阅者复核候选内容，文档发现已修。P-005 的完成只表示本地候选版已可复查，不表示其他 slice、在线主网、Agent 或比赛提交完成。

> writes: `docs/b-deliverables/`, `docs/c-acceptance-review.md`, `本计划`, `docs/local-integration-acceptance.md`, `docs/evidence/2026-10-07-integration/`；已有 A 证据仅原样引入
> anchors: `用户2026-10-07本地整合请求; AC-002/003/007/008; D-002/004/005/007; TC-002/003/006`
> verify: `pnpm typecheck；pnpm test；pnpm build；git diff --check；Markdown 本地链接、JSON/schema 与源码未变核查；如实际运行 HTTP，记录模式/状态及未运行项`
> review: `全部候选 diff；数据和未知项口径；未校准研究不改变默认策略；不把估算写为实测；保护原 journal 和权限`

## P-006 D 原生前端整合与 main 合并

固定 D 来源为 `a3f227238011cc0a56b8a40bc87caf0583a8da02`，保留其提交历史及 P-005 中已审阅的 A/B/C 材料。前端由 Next/React 迁移到 `web/` 的原生 JS/Vite 和 `server/` 同源 HTTP；Guardian 移到 `/guardian`，交易核验等既有深链接保留。公共领域合同与核心 Policy/Executor/事件安全语义保持稳定，必要修复只解决合并和实际验收发现的问题，不另行设计产品功能。

使用已有隔离 worktree，保留旧 journal；新 HTTP/页面检查使用另一个明确命名的 Mock journal。真实只读查询如实记录 RPC 成功或失败。指纹默认 Demo，行情/新闻源缺失不伪造；BOT 测试网模块、模拟报告与真正 Ethereum 证据分别标明。没有进行钱包连接、签名、部署或铸造就不能记为通过。

合并完成条件是整合 diff 独立审阅无未解决的 Critical/Important 问题，typecheck/test/build 及仓库新增的 HTTP、指纹与构建回归通过，浏览器实际检查首页、Guardian 与只读调查入口；README 启动步骤与新路径一致。创建并附加集成 PR，经检查后合入 main，验证远端 main 包含该集成 commit；不删除队友分支或改写远端历史。

实际完成：2026-10-07 18:52，[PR #5](https://github.com/cinderharbor7/xjy/pull/5) 合并为 `2f2ed63`，GitHub CI 通过；远端 main 已核验包含集成 `9f87b8d`，本地主工作区快进同步。18:53 本地主工作区 typecheck 与 969 passed / 6 skipped 再次通过。证据见[新版验收](../../local-integration-acceptance.md#d-整合与发布前复验)。P-006 完成不代表 P-001–004、真实 Agent、公共 BOT 部署、产品需求或比赛提交完成。

> writes: `D 来源分支的整合 diff`, `必要修复与相应测试`, `README.md`, `docs/unified-frontend.md`, `docs/local-integration-acceptance.md`, `本计划`, `docs/evidence/2026-10-07-integration/`
> anchors: `用户2026-10-07明确合并请求; AC-003/004/007/008; D-008; TC-007; 公共合同稳定; A/B/C证据保留; 既有computer use验收授权; 不广播未授权交易`
> verify: `pnpm install --frozen-lockfile；pnpm typecheck；pnpm test；pnpm build；pnpm test:fingerprint；pnpm contract:check；pnpm test:http；pnpm test:sculpture；实际浏览器入口/报告/Mock闭环；git diff --check；GitHub PR/main状态`
> review: `整合exact diff；HTTP同源/钱包/事件状态；前端证据与未知项；钱包确认和公开配置；运行及文档迁移；无未授权部署或秘密提交`

## P-007 逐项替换 Mock：公开行情第一项

用户明确要求逐项换成真实能力。沿用同一计划记录进展；第一项复用现有 `/api/market` 与币种数据读侧，让首页和有行情的币种页默认读取公开快照。只在明确手动选择时使用 Demo，失败保留缺失/错误或明确标注过期，不补样本。保留已验收的本地 Mock 收藏和真实 NFT 边界；来源、时间与 USDT 单位清楚。

验收需包含默认ETH首次加载、公开读成功、网络错误、空数组/错误模式、手动Demo往返、收藏回归与实际公开API结果。本项完成不代表所有Mock已替换。后续真实A→B网页报告、真实Agent和执行逐项处理，当前不据此捏造模型/Confidence，不自动进入主网交易。下一项若涉及尚未确定的接口/权限或所需凭据，先明确实际决策。

实际完成：2026-10-07 19:47，typecheck 通过；完整测试 976 passed / 6 skipped；build 通过；隔离 HTTP 检查 11 路由、静态资源、同源保护、Policy 版本与重复事件阻止通过。只读独立审阅未发现明确缺陷。实际 `/api/market` 返回 `live` / Binance Spot，快照时间 `2026-10-07T11:38:52.952Z`，ETH 报价 2573.37 USDT（仅该次快照，非当前价格承诺），8 个币种；情绪为 Alternative.me 全市场数据。生产预览已重新构建，未进行视觉验收、钱包签名或真实交易。

> writes: `web/app.js`, `tests/frontend/`, `README.md`, `冻结文档D-010`, `本计划`
> anchors: `用户逐项换真请求; AC-010; D-010; TC-009; 保留AC-009/D-009/TC-008`
> verify: `pnpm typecheck；pnpm test；pnpm build；pnpm test:http；实际/api/market读取；git diff --check`
> review: `公开/样本状态与报价来源；失败不填Mock；真实铸造/Guardian不变`

## 2026-10-07 执行方式更新：统一编码，分角色核验

用户要求将逐项换真 TODO 和分工发布到 GitHub。按最新安排，Codex 统一顺序实现与集成，队长决定范围、人员认领及发布；A 数据核验、B 调查/方法验收、C 权限/执行安全验收、D 页面视觉与比赛材料。工作安排不等于成员已认领。原 P-001–004 保留历史编号和状态，不代表四个编码分支现在同时推进。

交付顺序及验收清单见 [README 最新 Update](../../../README.md#2026-10-07-update--逐项换真与团队执行分工)：公开行情已发布；Aave 前端入口隐藏本地已验收；真实卖压→报告、事实/推断/未知分层、真实 Agent 为 P0，持续只读与 Fork 保护为 P1，BOT 为单独 P2。后续项均未完成；模型服务/凭据、真实监控恢复参数及公开链部署条件尚待明确，不默认授予权限。保留用户确认的本地 Mock 收藏和实验来源标签。当前任务只发布 TODO/分工与已验收隐藏改动，不实现上述待办。

Aave 隐藏验收：977 passed / 6 skipped、typecheck/build 和隔离 HTTP 11 路由通过；三处导航无入口，旧路径/API保留，独立审阅未发现问题。本轮未进行视觉验收、签名或主网交易。

## P-008 B/C 交付整合与 AI 边界修复

用户明确授权整合：A 已在 main；移植 B 的解释材料和 AI Adapter，合入 C v2 验收记录。B 的独立初始化历史不整支覆盖 main。保持现有领域 schema、默认规则分析、HTTP 和执行装配不变；本项不代表真实模型、页面接线或自主 Agent 在线验收。

必要修复遵循既有失败语义与证据合同：AI 缺配置/请求或输出失败明确报错，无静默规则回退；引用来自给定证据目录，模型解释标为推断，置信度不得突破输入引用覆盖规则上限；请求超时覆盖响应体；构造证据保存校验后的副本。B 接入代码负责人、Codex 做 A/接线/集成；A 数据核验，C 安全与 Fork 验收，D 页面和比赛材料。成员认领仍由队长确认。

实际本地整合验收（2026-10-07）：998 passed / 6 skipped，其中AI边界21项；typecheck/build、合约一致性、5项指纹/本地EVM、隔离HTTP 11路由及shader检查通过。独立复审前次5项均修复，无新增重要问题。没有外部模型、签名、主网交易或本轮视觉验收；默认运行流程未改。

> writes: `B/C交付文件`, `AI adapter/tests必要修复`, `README.md`, `本计划`
> anchors: `用户BC合并整合请求; AC-011/D-011/TC-010; 原失败不fallback约束; 稳定InvestigationResult; Policy无直接模型执行权限; 真实状态与未知项`
> verify: `pnpm typecheck；pnpm test；pnpm build；pnpm test:http；pnpm test:fingerprint；pnpm contract:check；GitHub CI`
> review: `独立 exact diff 安全审阅；事实引用/置信度/输入快照/超时/来源标签；重要问题修复后复验`

## P-009 真实只读报告与 RPC 查询效率

用户要求完成剩余 TODO，按此前建议采用新增 `/report` 与 `POST /api/onchain-analysis`，保留旧 `/api/eth-risk` 样本合同。报告展示同一观察的 Portfolio、Market、两个相邻窗口卖压、规则 Risk、证据、解释与未知项；不保证异常或固定高分。历史区块定位改为从 anchor 向前指数括界再二分，不假设出块间隔，不增加重试、备用 RPC 或 Mock 回退。

本地代码与受控页面回归已通过（1041 passed / 6 skipped，typecheck/build、隔离 HTTP 12 路由）。实际 CLI 与 HTTP 各成功读取过完整快照；同轮浏览器请求仍限流失败。dRPC code=15 的限流诊断、完整成功 JSON 已保存到 `docs/evidence/2026-10-07-real-report/`。已向用户请求专用 RPC；公共节点稳定性和成功页面在线流程不能标为通过。浏览器确认 RPC/缺AI配置失败均无旧报告，历史备份可正确显示事实/解释/未知项；真实 AI 待凭据。

> writes: `src/modules/onchain/ethereum-reader.ts`, `src/integration/onchain-report.contracts.ts`, `src/integration/onchain-report.ts`, `src/app/api/onchain-analysis/`, `server/`, `web/`, `tests/`, `docs/onchain-report.md`
> anchors: `用户完成剩余TODO; D-012/AC-012/TC-011; 旧API和领域合同不变; 同源只读; 失败不填Mock`
> verify: `pnpm typecheck; pnpm test; pnpm build; pnpm test:http; 实际RPC完整报告及真实交易核验; 页面功能验收`
> review: `独立审阅exact diff: 输入/同源/安全错误/范围/窗口/证据/无交易权限`

## P-010 显式 AI 调查与在线验收

新报告可显式选择规则解释或 AI 调查，既有 Guardian 和 CLI 默认规则不变。复用已审阅 AI Adapter，服务器读取配置，浏览器不接收密钥或 endpoint。配置缺失先拒绝，无规则 fallback。真实模式附明确调查来源；风险计算仍为未校准启发式。用户已回答“留着，我自己到时候会给你”：凭据暂不提供，代码和受控测试继续，真实外部模型验收保持待完成。

> writes: `src/modules/risk/onchain-analysis.service.ts`, `src/integration/onchain-analysis.ts`, `src/integration/onchain-report.ts`, `tests/`, `.env.example`, `README.md`
> anchors: `用户模型稍后提供; D-012/AC-012/TC-012; D-011既有AI边界; 非自主调查/非执行授权`
> verify: `规则/AI成功、缺凭据、证据不足、模型错误受控测试; 配置后真实AI正常/不足/失败验收; 未在线运行不得标完成`
> review: `独立exact diff安全审阅; 引用/未知项/置信度上限/服务端密钥/默认流程不变`

P-010 后续进展（2026-10-07 22:58）：用户提供 DeepSeek 本地凭据，服务器配置 flash 并显式关闭 thinking。历史完整快照和受控证据不足输入调用真实模型通过，受控无效凭据 HTTP401 明确失败无 fallback；默认思考曾截断 JSON 的诊断及公开结果见真实报告验收。完整1043 passed / 6 skipped、typecheck/build通过，独立审阅无重要发现。随后真实RPC→AI HTTP200和浏览器生成均实际成功一次（区块26141257/26141263）；详情及JSON见验收记录。公共RPC稳定性仍未通过，完整录像/发布/提交继续等待。

## P-011 演示材料、发布与提交收尾

准备固定真实案例、日期/范围明确的历史输出备份与两分钟讲稿。录像须实际录制并核验可播放；未录制不能用截图或文稿代称。运行检查通过后展示可审阅改动，Git合并/发布在用户明确确认后执行；正式比赛提交及回执按主办方要求和用户操作证据记录。BOT、主网交易、校准与收益预测不扩大进本轮。

P-011 进展（2026-10-07 23:40，D，分支 `d/real-report-ai-verify`）：D 的演示材料已统一并入基于最新 main（`86a3d14`，真实报告已合并）的本分支——[PPT 逐页内容](../../hackathon/presentation.md)、[6 分钟讲稿＋答辩](../../hackathon/talk-script.md)、[提交说明](../../hackathon/submission.md)，AI 口径已按 D-012 实测更新（显式 AI 已接线、三类实测通过、在线各一次、非自主 Agent）。本分支复跑 `pnpm typecheck` + `pnpm test`：**1043 passed / 6 skipped**。P-010 标记 done：规则/AI 成功、缺凭据、证据不足、模型错误受控测试与配置后真实 AI 三类验收均已有 22:58/23:00 实测证据。P-009 保持 in_progress：专用 RPC 未配置（本机当前无 `.env.local`），公共 RPC 稳定性与专用节点重跑未通过。仍待完成：完整主线录屏（需用户视觉验收）、队长补 TBD、四人复述核对、正式提交与回执。

> writes: `README.md`, `docs/demo-cases.md`, `docs/demo-runbook.md`, `验收记录与历史实测备份`
> anchors: `用户剩余TODO5/6; AC-008/TC-006; 视频、发布、正式提交分别举证; 不虚构用户/效果`
> verify: `最终typecheck/test/build/http; 两分钟讲稿与实际能力一致; 录屏可播放; 经确认Git合并发布; 提交成功回执`
> review: `材料来源/日期/模式准确; 待办及未验证项保留; 不混淆历史和实时`

## Integration And Final Verification

本计划覆盖 AC-001–012、D-001–012、TC-001–012；各 slice 的 anchors 指向冻结方案中的需求、设计合同和验收。P-001–005 保留当时的边界；P-006 记录后续授权的 D 迁移与必要修复；P-007 记录公开行情逐项换真；P-009–011 记录用户后续报告/AI/收尾任务。公共领域合同、核心 Policy/Executor 与事件状态保持原样。共享文件先由负责人完成，再顺序复核；不能让多人同时覆盖同一材料。

修改前基线为 2026-10-07 15:54 的 `pnpm test`：**896 passed / 2 skipped**。历史运行验收见 [交易核验记录](../../transaction-check.md) 和 [团队集成验收](../../team-integration-acceptance.md)。只有新鲜命令/实际操作才可证明最终结果；后续经授权修改代码时重新跑相应检查。

最终核查逐项对齐模式、日期、数量、窗口、出处、未知项、AI 对照原始记录和提交回执。交付时间与睡觉安排见 [冻结方案 10.2](../design/2026-10-07-hackathon-freeze/需求设计文档.md#102-交付检查点)，本文件不建立计时器、提醒或自动提交。

### 两分钟展示口径

开场说明公开误读案例及当前支持范围：候选使用者需要把一条 ETH 线索交成可复查简报；需求仍是假设，工具不能核实所有身份和动机。

先展示 A→B 的实际窗口、基线、gross sell volume、计算方法与引用。真实数据不一定异常；分数是未校准规则，不能讲成未来跌价概率。再独立核验转账与本池兑换，显示精确数量与未知项，不能升格为全笔净方向。

如需展示保护，明确切换独立 Mock/Fork，用户硬规则批准动作，独立读取 after 并验证。结尾只报实际测到的比较结果，说明人工步骤与真实 Agent 缺口。

### 可复制的团队消息（尚未发送）

> 大家现在冻结比赛主线：做可复查的 Ethereum 异动调查原型，附受限保护执行实验。A 整理真实窗口、交易和数据出处；B 整理分析方法、事实与未知项，做通用 AI 对照；C 复核证据边界、失败反例和原保护实验；D 统一演示、PPT、讲稿与录屏。原技术目录和合同不变。现有量化与核验是真的，Agent 调查尚未实现，需求与付费尚未验证；不接新模型，不扩大主网执行。按冻结方案检查点完成内容、排练和提交，队长确认实际认领与回执。

## Handoff And Residual Risks

Blockers: P-009 在线稳定性仍需专用 RPC（公共节点已实测限流/历史读取失败）；模型凭据已配置；P-010 在历史/受控输入上的真实模型验收已通过，完整实时 HTTP/页面已各成功一次，公共RPC稳定性仍未通过。完整主线视频、Git发布确认和正式提交回执仍未完成。不能以受控测试、一次HTTP成功或历史备份替代这些要求。

Residual risks: 真实 Agent 协作未交付，创新性和场景价值仍需方法、案例与实测支持；没有用户采用或付费证据。三项能力尚未形成完整真实自动链路。Fork/网络、导师反馈、内部认领、提交格式和 BOT 主网状态都按实际结果记录；截止时间不为未完成部署延期。

Resume note: `codex/real-investigation-report` 已有真实报告/显式AI接线与受控测试；用户现已授权提交并 push 此候选分支，main 合并未获本轮授权。3102 为本轮隔离 Mock journal + 真实只读 RPC 预览，不触碰3101旧状态。先检查用户是否已配置专用RPC与模型凭据（仅显示是否配置，勿打印值），完成在线验收与视频，再按明确用户确认执行Git发布；正式比赛提交需实际材料与回执。用户已授权当前源码/接线任务，不重新问同一范围；主网执行/BOT/外部消息不在本轮。
