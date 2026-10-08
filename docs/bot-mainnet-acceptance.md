# BOT 主网接线验收 · 2026-10-08

用户提供主网地址与已有交易，授权必要修复，未授权新签名或Git发布。基线有15个NFT测试失败（前端677，fixture968）。在原工作树保留用户前端及presentation改动，补齐报告存证底层、主网默认registry与隔离状态；不修改.env/private key或用户运行进程，不打开浏览器。

## 实际链上核验

RPC Chain ID=677。合约 `0x1bA50A79BEB8d44c0f9ff1D4dBdDCa523eFb340e` 的491字节runtime code哈希与项目RiskReportRegistry artifact完全一致，与NFT不一致。

[用户给出的交易](https://scan.botchain.ai/tx/0x7de08a6cdbc77c938014c2178f92927665b79ac5ec8762d99b08c931bf84eb73) 是成功PUBLISH调用：to=该合约，contractAddress=null；区块25912843。发布者、报告hash、ReportPublished事件、mapping时间和区块时间全部一致，实际通过修复后的confirmTransaction/verifyOnChain读取。公开原始证明见[核验JSON](evidence/2026-10-08-bot-mainnet.json)。这是已有交易，不是本轮新发送；没有原report JSON不能确认原文或语义正确，不虚称创建合约回执。

本机Node直连RPC超时，经现有环境代理后成功；只读脚本使用NODE_USE_ENV_PROXY=1，不修改环境文件或给浏览器偷偷加fallback。其他电脑网络、钱包交互和公开RPC稳定性仍按实际验收。

## 接线与回归

- 钱包添加/切换、RPC、回执、默认registry和链接统一677；旧变量不静默控制主网读侧。
- 主网pending/intent/report/contract独立命名空间；旧global及NFT968 pending存在时拒绝新签名，不跨链查询，不删除。
- 旧968 anchor仍可解析、保存，但主网UI核验前拒绝；新anchor677，不改变正文hash格式。
- NFT677测试与现有前端同步；registry不作为NFT地址。Mock收藏不修改968或677真实链存储。
- baseline失败和新网络/旧pending回归的预期失败已观察；修改后完整 `pnpm test`：1050 passed / 6 skipped。`pnpm typecheck`、`pnpm build`通过。
- `pnpm contract:check` 与隔离 `pnpm test:http` 通过（12路由、来源保护、Policy版本和Mock去重，不代表钱包主网新交易）。主网RPC对localhost来源的POST返回677且Access-Control-Allow-Origin为*；未使用真实浏览器或签名。
- 独立安全审阅发现旧NFT pending和误导测试网文案，两项已修复并复审，无新的重要发现。

代码/测试通过不代替新钱包签名、NFT部署、原文核验、主网长期可用性或比赛正式提交。代码发布状态以仓库提交历史为准。
