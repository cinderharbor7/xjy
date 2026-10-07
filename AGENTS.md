# xjy 项目约束

- 全站前端统一为 `web/` 下的 HTML、CSS、原生 JavaScript、Tailwind。不要重新引入 React、Next 页面、JSX 或 iframe 子站。
- 排版与分区采用瑞士国际主义；配色沿用 VERDANT 的 paper / sand / ink / moss / sage / clay。所有页面共享导航、设计变量与币种身份。
- 货币指纹是币种通用表现，复用统一注册表与绘制逻辑。ETH 专属研究和保护能力不得虚称已支持其他币种。
- 用户负责视觉检查。不要启动浏览器、截图、执行视觉验收；根据用户反馈修改，并完成必要的构建、接口与功能检查。
- TypeScript 后端保留共享 Zod 数据合同、真实/Mock/Fork 来源、固定钱包、Policy 权限、持久化事件去重和独立执行后核验。前端框架迁移不授权扩大交易范围。
- `src/app/api/` 目前为保留路径的标准 Request/Response 处理器，由 `server/index.ts` 提供服务，不依赖 Next 路由系统。
- 未经当前任务明确授权，不修改 `.env*`、`.guardian/`、私钥、生产监控启停或其他运行进程。验证使用隔离 Mock 数据库；不要用删除状态的方法绕过去重。
- BOT Chain Testnet 为 968 / 0x3c8，RPC https://rpc.bohr.life，浏览器 https://scan.bohr.life。报告存证与指纹 NFT 是独立合约；部署/发布/铸造均需用户钱包确认。
- 缺失行情保持缺失；身份指纹使用中性参数。Alternative.me 是市场背景，链 TVL 与协议 TVL、原生 ETH 与 WETH 必须区分。
- 当前前端整合使用 `codex/unified-vanilla-fingerprints` 分支。用户已授权清理前端遗留，旧 `next-env.d.ts` 的本地修改已备份到忽略的 `output/frontend-cleanup-backup/` 后删除；不要重新生成 Next 类型文件或 JSX 配置。
- 前端设计技能：`C:/Users/18364/.codex/skills/anthropic-frontend-design/SKILL.md`。用户风格和验收约束优先。
