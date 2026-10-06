# 可选扩展：Aave 真实只读仓位

输入 Ethereum 钱包地址，返回 Ethereum 主网 Aave V3 Core 的真实账户快照。页面是 `/position`，API 是 `POST /api/position`。有效读取能力已隔离到 `src/extensions/aave/`，作为可选只读扩展保留；首页 `/` 与 `POST /api/rescue` 是新的 Guardian Mock 单向减风险流程。

## 运行与手工查询

需要项目规定的 Node.js 和 pnpm 版本。配置仅在服务器读取：

```bash
pnpm install
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
MOCK_MODE=true
ETHEREUM_RPC_URL=https://eth.drpc.org
AAVE_NETWORK=ethereum-mainnet
```

公开 dRPC 是本地演示的配置示例，应用没有硬编码备用 RPC。自有 RPC 必须支持 Ethereum 主网、最近 7200 区块的历史 `eth_call`，以及 EIP-1898 的 `blockHash` 和 `requireCanonical: true`；不要求签名账户、私钥或 LLM key。修改环境配置后重启开发服务器。

```bash
pnpm dev
```

打开 [http://localhost:3000/position](http://localhost:3000/position)，输入下方已验证的测试钱包后查询。也可直接请求：

```bash
curl -i http://localhost:3000/api/position \
  -H 'Content-Type: application/json' \
  --data '{"wallet":"0x485c028c475dba482297656229d11b4eaf22357b"}'
```

`MOCK_MODE` 仅控制 Guardian 核心 Demo，不能将真实查询切换为 Mock。缺失配置或读取失败时真实查询明确返回错误，不重试、不降级、不返回 fixture。`PRIVATE_KEY` 和 `LLM_API_KEY` 当前不使用；`.env.local` 已忽略，真实密钥不得进入 Git。

## 固定边界与读取来源

```text
Dashboard /position
  → POST /api/position
  → src/extensions/aave/integration.ts
  → AavePositionAdapter
  → Ethereum PublicClient / Aave V3 Core
  → PositionSnapshot
```

仓位来源是 Pool 的 `getUserAccountData(wallet)`，获得 Aave 账户聚合抵押品、债务和 HF，而不是整个钱包余额。[Aave Pool 文档](https://aave.com/docs/aave-v3/smart-contracts/pool)

服务端先取得当前快照区块，再在该区块解析 PoolAddressesProvider 的 Pool / Oracle。账户数据、oracle USD 基准单位、WETH 价格与快照时间绑定到这个区块。ETH 价格在本接口指 Aave 的 WETH/USD oracle 价格。[Aave Oracle 文档](https://aave.com/docs/aave-v3/smart-contracts/oracles)

所有当前和历史合约查询分别绑定已读取的 `blockHash`，并要求 `requireCanonical: true`。区块重组、非 canonical hash 或 RPC 不支持该参数时直接报错，避免返回数据与证据属于不同区块的快照。[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)

本项目固定 `@aave-dao/aave-address-book@4.71.3`，从官方地址包取得 Ethereum Core 的 Provider 与 WETH 地址，不由请求或前端提供。Pool / Oracle 在查询区块从 Provider 读取，以返回值作为证据。[Aave 地址簿](https://github.com/aave-dao/aave-address-book)

当前部署的参考地址如下；查询响应中的地址是对应区块实际读取的证据：

| 来源 | 地址 |
| --- | --- |
| PoolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` |
| Pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Oracle | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |

链上金额以 bigint 读取，使用 oracle 的 `BASE_CURRENCY_UNIT` 转换 USD。当前基准必须是表示 USD 的 zero address，单位必须为十的正整数次幂；HF 按 1e18 精度转换。输出沿用已有 TypeScript `number` 契约，因此用于该扩展的展示和分析，不是交易金额编码；将来执行 Adapter 应独立获取代币及单位，不从这些展示浮点数构造签名交易。

## 扩展的独立接口

| 消费者 | 接口 | 返回和责任 |
| --- | --- | --- |
| 扩展维护者 | 扩展本地 `PositionAdapter.getPosition(wallet): Promise<AavePositionState>` / `PositionService` | Aave 聚合借贷数据；无借款抛出 NO_DEBT，不生成假 HF |
| 扩展 API / 页面 | `getAavePositionSnapshot(wallet): Promise<PositionSnapshot>`，位于 `extensions/aave/integration.ts` | 按 ACTIVE / NO_DEBT 显示，行情和证据在 position 外 |
| Guardian 核心 | 本里程碑无数据装配 | 不向核心 Risk / Policy / Executor 传递真实 Aave 数据 |

合同只属于 [扩展 schemas](../src/extensions/aave/schemas.ts)，[扩展类型](../src/extensions/aave/types.ts) 通过 z.infer 推导。本地 AavePositionState 字段沿用此前公开 JSON；新核心 PortfolioState 独立定义，不将 Aave 聚合抵押/债务当作整个钱包组合。扩展没有核心 Domain import，核心也没有扩展 import。

`getPosition` 复用完整 `getSnapshot`，因此同样要求 RPC 支持7200区块历史窗口，历史读取失败会让该调用明确失败。无借款时抛出 PositionReadError，code=NO_DEBT；扩展 API 使用 getSnapshot，把无借款作为正常响应。

`PositionSnapshot` 的两种 HTTP 200 结果：

- **ACTIVE**：mode / wallet / status，加本地 `position: AavePositionState`、`marketChanges`、`evidence`。position 的 wallet、blockNumber、timestamp 必须与外层和证据一致，debtUsd > 0。
- **NO_DEBT**：mode / wallet / status，加 `position: null`、`message`、`evidence`。空地址仓位和有抵押无借款均走此结果；没有 marketChanges 或伪造的 healthFactor。

请求只接受严格 `{ wallet: string }`，必须是 `0x` 加 40 位十六进制地址；trim 后保留请求的大小写。请求中的额外字段会被拒绝，不能选择网络、RPC 或合约。

## 行情窗口和链上证据

ACTIVE 读取前 **7200 区块**的 WETH/USD 价格，计算 `ethChangePct = (current / previous - 1) × 100`。历史区块单独解析其 Provider / Oracle 及 USD 单位。历史读取失败返回错误，不能拿当前 oracle 价格或静态数据补齐。

marketChanges 同时提供 `previousEthPrice`、`referenceBlockNumber`、`referenceBlockHash`、`referenceTimestamp`、`referenceOracleAddress`、`lookbackBlocks`、`lookbackSeconds`。区块生成速度会变化，**该窗口不是精确 24 小时，也不是 Guardian MarketState 的5m/1h行情**；页面和消费者应采用实际秒数。

evidence 保留主网 chainId / network / protocol、Provider / Pool / Oracle / WETH 地址，以及快照 blockNumber / blockHash / blockTimestamp。预留可选 txHash，但只读 `eth_call` 不产生交易，本里程碑不填该字段。测试钱包的历史借款交易是单独的证据，不能当作本次查询产生的交易。

## 已验证测试钱包和记录

测试钱包：[`0x485c028c475dba482297656229d11b4eaf22357b`](https://etherscan.io/address/0x485c028c475dba482297656229d11b4eaf22357b)。这是公开现存仓位的只读样本，本项目没有该钱包控制权，没有创建或修改资金仓位。

真实 Borrow 交易：[`0xd5970586aa226ebb0ba9a55dbd02e377b31b5f62716e0f88ff7500a442c58593`](https://etherscan.io/tx/0xd5970586aa226ebb0ba9a55dbd02e377b31b5f62716e0f88ff7500a442c58593)。查询回执确认其位于区块 **26133720**，status=1，发送方为该钱包、接收方为 Core Pool，Borrow 事件的 onBehalfOf 为该钱包。

先前 Aave 里程碑记录的真实快照位于区块 **26133728**，UTC 时间 **2026-10-06T13:47:47Z**（北京时间 21:47:47）。这是可审计的历史样本，**不承诺未来实时查询值固定**；钱包持有人可能还款或改变抵押品。

| 字段 | 已记录值 |
| --- | --- |
| collateralUsd | 3582.01428638 |
| debtUsd | 1092.89096989 |
| healthFactor | 2.609328551118806 |
| ethPrice | 2716.45427768 |
| blockHash | `0x38b551e537128b04aaacd04f1986597752e5f10bbd5c0adc98ed9e1c353f4f52` |
| referenceBlockNumber | 26126528 |
| referenceTimestamp | 2026-10-05T13:41:11Z |
| previousEthPrice | 2724.17 |
| lookbackSeconds | 86796 |
| ethChangePct | -0.2832320420531831 |

该样本也作为 [OpenAPI ACTIVE example](position-api.openapi.json) 提供完整 JSON。普通无借款分支的验收可查询 `0x0000000000000000000000000000000000000001`；实际以链上债务是否为零判断，不依赖特定地址硬编码。

## HTTP 契约与运行失败

成功：HTTP 200，`application/json`，`X-Position-Mode: LIVE`，`Cache-Control: no-store`。ACTIVE 和 NO_DEBT 都是正常查询结果。

错误：RFC 7807 `application/problem+json`，固定 `instance: "/api/position"` 和 `type: "urn:xjy:position:<code>"`，含非空 title / detail 及 status / code。detail 不含 RPC URL、凭据或原始异常堆栈。

| HTTP | code | 触发条件 |
| --- | --- | --- |
| 400 | INVALID_WALLET | 无效地址、非法 JSON、缺字段或未知字段 |
| 503 | CONFIGURATION_ERROR | 缺失 / 无效 RPC 配置、不支持的 AAVE_NETWORK |
| 502 | UNSUPPORTED_NETWORK | RPC 返回的 chainId 不是 1 |
| 502 | INVALID_CHAIN_DATA | 无效基准单位 / 地址 / 价格 / HF / 区块证据 |
| 502 | RPC_READ_FAILED | RPC 调用失败、超时、窗口历史不可读取、canonical hash 查询被拒绝 |

RPC 使用 viem HTTP transport，`retryCount: 0`，超时 10 秒；没有备用 RPC、重试或 Mock fallback。接口不需要认证，读取公开账户数据，不能接受或签署交易。每次请求独立读取，不持久化、无写操作，无幂等记录和并发更新冲突。单钱包聚合快照不需要分页或过滤；本地 Hackathon Demo 未增加限流，公开部署的访问控制需在部署范围确定后另行设计。本轮架构纠偏保留此扩展路径及查询响应；核心 `/api/rescue` 已整体换为 Portfolio RescueSession，与扩展无关。

完整 OpenAPI 3.1 见 [position-api.openapi.json](position-api.openapi.json)。仓库未安装独立 OpenAPI 规范校验器；文档验证覆盖 JSON 解析、内部引用和示例的 Zod 校验，未执行完整 OpenAPI 规范校验。运行时契约及接口分支由项目测试检查。

## 可选扩展验收标准

```bash
pnpm typecheck
pnpm test
pnpm build
```

- [ ] 上述检查全部通过；新增测试覆盖读取固定区块、USD / HF 精度、行情窗口、schema 一致性与 API 分支，Guardian 核心与扩展测试都通过。
- [ ] 配置主网 RPC 后打开 `/position`，明确看见 **LIVE / READ ONLY**；输入有效借款地址，显示真实 collateral、debt、HF、ETH/USD，以及完整 camelCase JSON。
- [ ] ACTIVE 响应钱包、position.blockNumber / timestamp 与 evidence 一致；当前及历史查询绑定 canonical 区块 hash，RPC 拒绝时终止；真实合约地址、区块 hash / 时间可以核验；没有声称产生新的 txHash。
- [ ] marketChanges 是历史区块真实 oracle 查询，区块差 7200，并披露实际时间差；实际价格变化符合公式。
- [ ] 无借款结果为 HTTP 200、NO_DEBT、position=null，HF 明确不适用；扩展本地 getPosition 不吞掉该情况或制造 AavePositionState。
- [ ] 无效地址 / 非法 JSON / 额外请求字段返回 400；缺 RPC 返回 503；错链、异常链数据或历史读取失败返回 502，问题响应不泄漏 RPC URL / 凭据。
- [ ] 页面只调用 `/api/position`；没有签名提示、写链 RPC 或 Executor 调用。
- [ ] 首页 Guardian Run Demo 展示风险敞口100% → Mock ETH/USDC转换 → 70%；未将真实 Aave 查询接入核心 Mock 执行。

离线自动测试使用注入的 RPC 读接口，固定边界数据，不依赖公共网络。现场验收还需实际 RPC / API / 浏览器查询；只有离线测试通过不能证明当时真实网络可读。
