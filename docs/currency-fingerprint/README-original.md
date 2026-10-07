> 历史文档：独立货币指纹原型阶段。项目已整合进 xjy，当前运行与结构见 [统一前端说明](../unified-frontend.md)。下文历史路径与命令不作为当前启动指引。

# 货币指纹 / Currency Fingerprint

独立的新项目。原生 HTML + CSS + JavaScript + 本地编译 Tailwind CSS；Vite 负责构建，Node 内置 HTTP 负责只读 API 缓存。没有 React、数据库、登录系统或 API 密钥。

产品需求、功能优先级与验收标准见 [PRD](PRD.md)；视觉规范见 [设计说明](DESIGN-original.md)。

## 运行

需要 Node.js 22.12+（本机验证为 24.14）。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。初次打开使用显式标记的演示数据，点击“接入公开数据”读取实际行情。服务只监听本机。源码修改自动更新；关闭服务后重新运行上述命令即可。

```sh
npm test
npm run contract:build
npm run build
npm start
```

`npm start` 提供 dist 与同源 API；运行前先停止占用同一端口的 dev 服务，或设置 `PORT`。仅把 dist 放到静态服务器上仍可浏览演示；公开数据需要本项目服务端。

## 已实现

- 首页焦点币种、鼠标视角互动、两列动态图鉴、类别筛选、关键词搜索和排序。
- 8 个币种详情：基本行情、动态指纹、24h / 7d 价格曲线、盘口、DEX、链 TVL、GitHub、来源状态。
- Canvas 参数化纹理和按需加载的 Shader Park 流体视图；离屏减少绘制、后台暂停、减少动态效果支持。
- 解释颜色、形态、节奏的数据映射；下载带 SVG 的 NFT 元数据快照。
- BOT Chain 钱包连接、网络添加/切换、合约地址字节码校验、钱包部署和 ERC-721 铸造流程。
- 等待交易回执并重新读取所有者、摘要后记入本地收藏。收藏按钱包区分，展示区块浏览器链接。
- 瑞士国际主义风格：Helvetica / Arial、中性灰黑底色、红色操作强调、直角与明确网格。

默认精选 ETH 是编辑选择，不是算法选股或收益推荐。图形不代表信用分。

## 数据口径与边界

| 来源 | 本版已接入 | 缓存与限制 |
| --- | --- | --- |
| Binance | 8 个 USDT 对的价格、24h 涨跌、高低、成交额与笔数；小时 K 线；100 档盘口；主动买入占比 | 行情和 K 线 60s，盘口 30s；±1% 深度仅针对返回档位，可能并非完整深度 |
| Alternative.me | 全市场 Fear & Greed；保留原始指标日期并署名链接 | 1h；不是某币独立情绪 |
| DEX Screener | 明确合约地址的返回交易池、流动性、买卖笔数 | 60s；ETH / SOL 使用 WETH / WSOL；返回池数量不声称覆盖全市场 |
| DefiLlama | 对应公链 TVL | 30min；不将链 TVL 当作单个代币或协议 TVL |
| GitHub | 显式仓库 Stars、Forks、Issues、最后推送 | 6h；推送时间不等于最后提交时间；尚未拉取 commits / contributors 历史 |
| GDELT | 24h 内最多 20 条相关新闻、来源关联示意 | 15min；本机实测超时，UI 显示不可用；没有捏造新闻或情绪分类 |

上游超时 9s；同一 URL 合并并发请求。失败缓存 60s，成功后失败会保留旧数据并标记“缓存已过期”；没有旧值则用 `—`，不会冒充实时。网页是手动刷新的公开快照，不是推送交易终端。

新闻“来源关联”只表示查询命中同一币种，不代表观点赞同/冲突。真实社交观点网络、新闻 NLP 情绪分类、开发活动历史、协议 TVL 历史和更多时窗尚未实现。相关数值不会用随机值填充。

波动率使用已收盘小时价格的对数收益率总体标准差乘 `sqrt(24)`，结果为百分数；7d 视窗表示在 7 天样本上估计日化值。最大回撤使用所选区间的小时收盘价。默认演示曲线是合成数据，不是历史行情。

## BOT Chain NFT

| 参数 | 值 |
| --- | --- |
| 网络 | Bohr Testnet / BOT Chain Testnet |
| Chain ID | 968 / 0x3c8 |
| RPC | https://rpc.bohr.life |
| Gas Token | 测试 BOT |
| 浏览器 | https://scan.bohr.life |

2026-10-07 已只读核验 RPC 返回 `0x3c8`，并通过公开节点的 `eth_estimateGas` 对本项目部署字节码进行模拟，返回 `0x154d6d`（1,396,077 Gas）。这不是交易；尚未在公开 BOT Chain 部署合约或发送铸造交易。

使用安装了 EVM 钱包的浏览器：进入“我的收藏 → BOT 测试网设置”，部署合约，或填写已有本项目同版本合约的地址。每次部署/铸造都由用户在钱包内确认；本项目不读取私钥、不自动交易、不要求转移其他资产。

合约：`contracts/CurrencyFingerprint.sol`。OpenZeppelin 5.0.2，编译目标 Paris，避免要求目标网络支持 PUSH0 / MCOPY。公开 `mint` 将图像、来源标记与数据快照放在不可修改的 data URI 中；SVG 采用同一参数面生成的固定纹理版，并非流体画面的截图。

每个账户不能重复铸造完全相同的 metadata URI；同一数据不同采集时刻是不同快照。合约不收铸造费，用户支付链上 Gas。样例 13,849 字节 URI 在本地 EVM 铸造消耗约 999 万 Gas（费用以钱包实际估算为准）。图片+数据完整链上保存，因此比只保存 IPFS 地址昂贵。

元数据由收藏者自行提交，合约不是可信价格预言机；上链证明内容被保存，不能证明第三方数据真实性。演示数据铸造前需额外勾选确认。

收藏页仅保存当前浏览器已确认交易的记录，不是全链资产索引；换浏览器不会自动恢复，转出后的最新所有权以链上为准。发送后关闭页面，仍需通过交易哈希到浏览器确认结果。

## 验证

`npm test` 包含缺失值、计算口径、参数边界、NFT 编码，以及本地 EVM 968 的部署、完整铸造、URI/摘要/所有权读取、重复拒绝、无效 URI 拒绝、转让。这里的本地 EVM 不等于公开 BOT 测试网。

初版已用 Edge 验证首页、搜索、进入详情和 Shader Park 加载；用户随后要求改为瑞士风格，并自行负责视觉检查。最终瑞士版只做构建/代码/接口验证，桌面和手机视觉均等待用户验收。

## 文件

```text
index.html                 页面壳
src/app.js                 路由、页面、交互
src/style.css              Tailwind 入口、布局、瑞士主题
src/data.js                币种定义、示例、计算口径
src/fingerprint.js         动态纹理、SVG、Shader Park
src/nft.js                 钱包与 NFT 元数据流程
server.mjs                 同源 API、缓存、静态服务
contracts/                 Solidity 合约
scripts/compile-contract.mjs
tests/                     数据与本地合约测试
public/fingerprint-contract.json   编译 ABI/字节码，不含私钥
```

## 参考

新设计 skill：Anthropic [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)，安装于 `C:/Users/18364/.codex/skills/anthropic-frontend-design`，后续对话可用。

文档：[Shader Park](https://github.com/shader-park/shader-park-core)、[Binance](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)、[DEX Screener](https://docs.dexscreener.com/api/reference)、[DefiLlama](https://api-docs.defillama.com/)、[GDELT](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)、[GitHub](https://docs.github.com/en/rest/repos/repos)、[Alternative.me](https://alternative.me/crypto/fear-and-greed-index/#api)、[OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/erc721)、[Tailwind](https://tailwindcss.com/docs/installation/using-vite)。
