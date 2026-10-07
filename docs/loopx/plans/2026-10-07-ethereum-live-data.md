---
source: docs/loopx/design/2026-10-07-ethereum-live-data/需求设计文档.md
status: done
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: [P-001]
  - id: P-003
    status: done
    depends: [P-001]
  - id: P-004
    status: done
    depends: [P-001]
  - id: P-005
    status: done
    depends: [P-002, P-003, P-004]
---

# A 真实 Ethereum 数据交付

## Goal And Boundaries

在feat/ethereum-live-data从已发布1ab57ee开始，仅交付A的真实ETH/USDC组合、Chainlink行情、Uniswap单池卖压和只读验收/交接。用户已确认三项数据口径；公共合同、Mock/API/B/C/D不变，不commit/push。多Owner及真实RPC验收需要可恢复计划。

## P-001 固定快照与真实oracle基础

建立只读client、canonical快照、时间查找、币种/池ABI和安全错误；历史/当前报价及更新证据可验证。

> writes: `src/modules/onchain/ethereum-reader.ts, src/modules/onchain/ethereum-contracts.ts, src/modules/onchain/read-error.ts, tests/ethereum-reader.test.ts, .loopx/intake/2026-10-07-ethereum-live-data/, docs/loopx/design/2026-10-07-ethereum-live-data/, docs/loopx/plans/2026-10-07-ethereum-live-data.md`
> anchors: `AC-001,003,006; D-001,002; TC-001,002`
> verify: `pnpm exec vitest run tests/ethereum-reader.test.ts; pnpm typecheck`
> review: snapshot时间/hash一致性、oracle新鲜度与来源、只读权限/凭据脱敏

## P-002 Ethereum组合Adapter

固定ETH/USDC余额及真实USD价值，通过旧getPortfolio接口输出；read-result补充证据，fresh调用重新捕获。

> writes: `src/modules/portfolio/ethereum-portfolio.adapter.ts, tests/ethereum-portfolio.test.ts, docs/loopx/plans/2026-10-07-ethereum-live-data.md`
> anchors: `AC-001,002,006; D-001,003; TC-001`
> verify: `pnpm exec vitest run tests/ethereum-portfolio.test.ts; pnpm typecheck`
> review: 单位、wallet绑定、非$1 USDC、范围、fresh重读

## P-003 Chainlink行情Adapter

三个oracle快照形成价格及5m/1h变化，波动代理使用用户公式，出处完整且旧getter不变。

> writes: `src/modules/market/chainlink-market.adapter.ts, tests/chainlink-market.test.ts, docs/loopx/plans/2026-10-07-ethereum-live-data.md`
> anchors: `AC-003,006; D-001,002,004; TC-002`
> verify: `pnpm exec vitest run tests/chainlink-market.test.ts; pnpm typecheck`
> review: 时间边界/证据、0%合法性、proxy定义、无真实tick承诺

## P-004 单池卖压Adapter及服务

严格完整日志、真实窗口/成交美元额/去重身份/链上引用，冻结Signal校验后交B。

> writes: `src/modules/onchain/onchain-signal.adapter.ts, src/modules/onchain/onchain-signal.service.ts, src/modules/onchain/uniswap-sell-pressure.adapter.ts, tests/uniswap-sell-pressure.test.ts, docs/loopx/plans/2026-10-07-ethereum-live-data.md`
> anchors: `AC-004,005,006; D-001,002,005,006; TC-003`
> verify: `pnpm exec vitest run tests/uniswap-sell-pressure.test.ts; pnpm typecheck`
> review: 买卖符号、全日志/去重/边界、事件块USDC报价、原始发起者、零基线、异常日志/引用失败

## P-005 只读验收及四人交接

装配A数据服务与CLI、严格JSON结果、human/help/错误，跑真实只读查询并同步README/环境示例/交接；独立审查后交B/D。

> writes: `src/modules/onchain/live-data.ts, src/modules/onchain/read-results.ts, src/modules/onchain/read-cli.ts, tests/ethereum-data-cli.test.ts, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, README.md, .env.example, docs/ethereum-data.md, docs/loopx/plans/2026-10-07-ethereum-live-data.md`
> anchors: `AC-001..007; D-001..007; TC-001..005`
> verify: `pnpm typecheck; pnpm test; pnpm build; pnpm data:read --help; 真实RPC下分项及JSON查询; git diff --check`
> review: final exact diff/权限与兼容性/出处/文档/未启用真实交易

## Integration And Final Verification

原283测试baseline通过。每个slice完成更新frontmatter并验证，再启用依赖结果；只允许disjoint写入，plan等共享文件仅由根更新。全量检查与真实RPC证据需新鲜输出。

前置证据：独立设计审查通过。配置RPC只读能力核验在主网区块26137353/hash 0x09921ac7379d8e12b9d8a39a7a1facdc52df3bca117cc2c3bdd68c0296ce75be成功：公开测试地址0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045的ETH和USDC余额及目标池最近50区块的41条原始日志均可读取。该核验不是最终Adapter/精确窗口验收。

## Handoff And Residual Risks

- Blockers: 无已知需求阻塞。
- Residual risks: 公共RPC可能限速/不支持历史或EIP1898；Chainlink可能旧轮次/过期，单池不是全市场；真实B/C/D仍待后续。
- Resume note: 根拥有intake/design/plan/CLI/README/config与Signal；独立代理可拥有基础读取、组合或行情单元，禁止代理spawn助手。代码/测试顺序整合，提交推送须另有明确授权。

P-001验证完成：ethereum-reader 85项测试通过、pnpm typecheck通过、diff检查通过。基础四文件已交还，启用独立P-002/P-003/P-004。

P-002/P-004顺序整合：组合51项、卖压42项scope测试通过；typecheck通过。已复读组合与卖压实现，旧合同/核心调用方未改。行情P-003验证完成后才能启用P-005。

P-003验证完成：行情29项测试、typecheck和diff检查通过，两个文件已交还并复读。P-001..004依赖全部验证，启用P-005只读装配/CLI/交接。

P-005当前验证：pnpm install通过（tsx 4.23.15，esbuild 0.28.2仅固定版本构建允许）；pnpm typecheck通过；pnpm test 17文件570项通过；pnpm build通过，现有5条页面/API路由不变；data:read --help通过。

ABI独立审查发现strict解码不能保证uint160/uint128/int24范围和indexed地址padding，已增加完整data/topics规范重新编码比对；4项回归加入卖压测试，46项scope通过。其余4模块测试与CLI共287项新增，加原283项共570项。

真实只读初验：公开测试地址在26137403块读到ETH 5.753535228062228、USDC 37.192124，合计约$15061.27，ETH敞口99.75%；行情ETH/USD $2611.27843079、5m -2.0948%、1h -3.1626%、proxy31.6261，附3个观察点证据。单池信号在[2026-10-07T02:02:59.000Z,02:07:59.000Z)读到当前gross USD1671406.907560754、基线1774456.824814565、ratio0.941925937102144、33笔卖出/27个tx.from、41条采样/块证据。早期signal查询曾被RPC拒绝(code15)，如实非零退出且不返回Mock/信号；诊断不包含URL/凭据。上述余额/行情/信号为不同只读调用，完整CLI共享anchor JSON验收与最终独立diff审查仍待记录。


## 最终验收记录

2026-10-07完整CLI `pnpm --silent data:read --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json`退出0，stdout为纯JSON。离线以EthereumDataResultSchema重新parse通过，三合同timestamp/windowEnd均为2026-10-07T02:08:23.000Z；区块26137421/hash 0x12b63ec6f90f7fcc1f4ab2b3efbdfabf92f24ea86a9b76d1ba96f327cd3aa905。

- ETH 5.753535228062228，USDC 37.192124；ETH USD14938.451881772873，USDC USD37.18855764722964，总USD14975.640439420104，ETH敞口99.75167300658916%。
- ETH/USD2596.39530995；5m -1.3944082967449423%，1h -3.7145359291096747%，价格变化proxy37.145359291096746。
- 单池当前[02:03:23,02:08:23)gross USD1292769.3568563564；紧邻前5m基线USD2116829.300256515；ratio0.6107102526876872；29笔卖出交易、26个tx.from。
- 余额/行情/信号证据分别4/3/41条。真实样例事件txHash 0xa030d1e530f8e405d751e4bad9b2e909ab3badb833d415a03682f3d6dc92712e，区块26137371，目标池，含logIndex/tx.from/报价出处。完整输出暂存在/tmp，不提交运行时数据或env。
- CLI非法wallet实测退出1，stdout为空，stderr为安全INVALID_WALLET JSON；help无需配置/网络。
- 最终代码独立审查无新修复项；ABI P2已修复并验证。审查人新鲜122项卖压/CLI测试与diffcheck通过。
- pnpm install、typecheck、17文件570项test、build全部通过；build保留首页、/position、/api/rescue、/api/position。README/环境示例/A交接验收文档已同步。

全部slice完成。原开发分支为feat/ethereum-live-data；随后用户明确授权创建feat/a-live-data并提交推送本地改动，交付分支设置origin同名远程跟踪。此次发布不修改main，主线集成由团队后续处理。下一步由B分析、C受限执行、D将只读服务接页面/API及监控。公开RPC会偶发拒绝，已观察安全失败；没有加入重试/备用源/Mock替补，也没有实现真实交易。

发布复核（2026-10-07）：pnpm test 17文件570项通过、typecheck及build通过，现有路由不变；远程main已有团队新提交bc1d504，本次仅发布独立feat/a-live-data分支。
