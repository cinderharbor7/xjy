# BOT Chain 风险调查报告存证

## 已实现与边界

独立页面 `/attestations`，入口位于 Guardian 和 ETH Risk Lab 导航。它只读取已有报告，不启动 Guardian、不重跑执行、不把 BOT 网络注入 Ethereum/Fork 服务。原有领域 schema、策略、执行适配器和持久化监控无需改变。

- `GUARDIAN_EVENT`：冻结事件中的调查/证据、策略决定与配置版本、提交记录、已有执行结果、独立验证结果。未知结果保留未知，不转换成成功。
- `GUARDIAN_SESSION`：最近一次运行的调查、证据、策略决定、已有执行/验证结果；包括没有获批交易的运行。现有 session 不带配置版本，因此不拿当前配置冒充历史配置。
- `ETH_RISK_LAB`：完整研究快照，包括模型、证据、置信度和建议。`policyDecision`、`execution`、`verification` 明确为 null，不拼接不相关 Guardian 交易。

报告保留原始数据模式。当前 Risk Lab 为 `MOCK_CHAIN_FIXTURE`；Guardian 的 `MOCK` 与 `FORK` 分开标记。Fork 余额和成交来自本机链，市场变化与调查仍是演示输入。未来 `LIVE_CHAIN_READ` 模式按源快照原样保存，不推断所有模型已经拟合。

BOT 存证是独立的真实链上交易，只证明指定地址在链上记录了这个哈希；不证明报告事实正确、模型准确或策略能盈利。内容正文不会发送到合约；发布者地址、哈希、时间及交易本身是公开记录。JSON 保存在本机浏览器并可以下载；清除浏览器数据不会删除链上记录，但会丢失本机草稿/待确认交易提示。

## 网络与钱包

| 项目 | 值 |
| --- | --- |
| Chain ID | `677` / `0x2a5` |
| 网络名 | BOT Chain Mainnet |
| RPC | `https://rpc.botchain.ai` |
| 原生币 | BOT，18 decimals |
| 浏览器 | `https://scan.botchain.ai` |

2026-10-08 只读 RPC 检查 `eth_chainId` 实际返回 `0x2a5`；已知主网回执及代码检查见 [主网验收](bot-mainnet-acceptance.md)。项目不接收、不保存 BOT 钱包私钥；部署与发布均由 MetaMask 签名。现有 `FORK_PRIVATE_KEY` 仅属于既有本机 Fork 执行，不用于 BOT 存证，BOT-only 操作无需配置它。

## 首次部署（用户在 MetaMask 操作）

1. 在安装并解锁 MetaMask 的 Chrome/Edge 浏览器中打开 `http://localhost:3000/attestations`。应用内置浏览器若没有 MetaMask 注入，请改用安装扩展的浏览器。运行本分支使用 `pnpm install`、`pnpm contract:check`、`pnpm dev`。
2. 点击“连接 MetaMask”，选中有主网 BOT Gas 的账户。展开“首次使用：部署存证合约”，点击“通过 MetaMask 部署”。
3. MetaMask 会请求切换或添加 Chain ID 677。核对上述参数，再在钱包中确认部署交易及主网 BOT gas。
4. 等待页面确认部署回执并核对合约 runtime bytecode。页面会显示并保存合约地址；本浏览器可立即使用。
5. 默认报告存证合约为已核验的 `0x1bA50A79BEB8d44c0f9ff1D4dBdDCa523eFb340e`，已有合约无需再次部署。页面也可填写其他同版本主网registry地址，核验后按主网保存。NFT不可使用该地址。旧 `NEXT_PUBLIC_BOT_RPC_URL` / `NEXT_PUBLIC_BOT_REPORT_REGISTRY` 测试网配置不再决定本轮主网网络或默认地址；不改私钥。

页面每次发布/核验都会检查 RPC chain ID 和合约代码哈希，拒绝错误网络、无代码地址及其他版本实现。换编译器、源码或编译设置后必须重新生成 artifact 并部署相应版本；不会把旧地址默认为新实现。

## 发布与核验

1. 选择研究快照，或读取并选择一个已有 Guardian 事件/运行。点击“固定报告并计算哈希”，下载原始 JSON 留存。报告不会在等待签名期间随监控更新。
2. 检查页面上的 Mock/Fork/真实来源标签、快照时间、内容和哈希。连接 MetaMask、填写已部署地址，点击“发布报告哈希”，在钱包确认 `publish(bytes32)` 交易。
3. 页面显示等待签名、已提交、待确认和确认结果，并提供 BOT 浏览器交易链接。确认后再次下载**含存证回执的 JSON**，其中记录 chain ID、合约、发布者、交易 hash 和链上时间。
4. 重新导入 JSON，核对预期发布者和合约，点击“重新计算并核验链上记录”。核验不需要连接钱包：检查内容哈希、链上 mapping；带回执的文件还检查对应交易的发布事件、发布者和时间。
5. 修改报告正文/证据/策略/已有结果任一字段后，用原来的声明哈希再导入，页面应报告不一致并禁止发布。若改了文件和哈希两者，仍须与可信发布者的链上记录匹配。不要把陌生发布者自行上链当作原发布者的认可。

取消签名不会自动重试。回执超时或 RPC 不可用时，页面保留已知交易 hash，只提供“查询原交易”，不自动重新广播；刷新后恢复本机待确认交易。明确 reverted 的交易不会显示为成功。链上同一发布者/哈希已经存在时拒绝重复发布，避免重复 gas。不同发布者可以分别存证同一内容，不能抢占或覆盖其他人的记录。

## 内容哈希规范 v1

JSON 外层包含 `format: "sorted-json-utf8-v1"`、`algorithm: "keccak256"`、`report`、`reportHash`，以及可选 `anchor`。只对完整 `report` 计算哈希，回执在发布后才产生，因此不属于内容哈希：

```text
reportHash = keccak256(UTF8(canonicalJson(report)))
```

规范化规则：递归按 UTF-16 code unit 顺序排列对象 key；字符串/有限数值按 ECMAScript `JSON.stringify` 编码；不改变数组顺序、不做 Unicode 归一化、无额外空白，UTF-8 后取 Ethereum Keccak-256（**不是** NIST SHA3-256）。`-0` 与 `0`、`1.0` 与 `1` 是相同 JSON 数值；空格、缩进、字段排列不影响哈希。拒绝 undefined、非有限数值、非普通 JSON 对象、孤立代理字符、重复 JSON key、过深/过大文件。

Schema 用于校验格式；哈希读取原始解析值，而非 Zod trim/转换后的值，防止格式正规化隐藏正文变化。`schema: "xjy.risk-investigation-report/v1"`、来源、模式、时间、所有证据及结果都在哈希覆盖范围内。合同/回执元数据单独与真实链上记录核对。

## 合约与构建

源码 `contracts/RiskReportRegistry.sol`。Solidity 固定 0.8.30，optimizer=200、EVM Paris，以免测试网依赖 PUSH0 等更新 opcode。无 owner、无升级、无删除、无转账、无外部调用，也没有 Guardian 执行权限。

```solidity
publish(bytes32 reportHash)
attestations(address publisher, bytes32 reportHash) returns (uint256 timestamp)
event ReportPublished(bytes32 indexed reportHash, address indexed publisher, uint256 timestamp)
```

`pnpm contract:compile` 生成已提交的 ABI/creation bytecode/runtime hash，`pnpm contract:check` 重新编译并检查 artifact 与源码一致。前端部署使用同一 artifact。普通 `pnpm test` 不向 BOT 网络发送交易。

## 验证

```text
pnpm contract:check
pnpm typecheck
pnpm test
pnpm build
node scripts/test-attestation-evm.mjs <Anvil可执行文件绝对路径>
```

本地 EVM 验收启动隔离的 127.0.0.1:19545 / chain ID 968，不接 BOT RPC。使用随机临时账户，只在该本地节点准备余额。实际部署合约，验证 code hash、发布者、区块时间、事件、重复拒绝、不同发布者不互相覆盖、零哈希拒绝。脚本结束后停止自己的节点。

历史测试网/本地EVM阶段结果：`contract:check`、TypeScript 和生产构建通过；普通测试 **359 passed / 6 skipped**（4 个需本地 EVM 的新合约测试、2 个既有 Fork 测试默认跳过）。新合约测试已通过上述隔离 Anvil 脚本单独实际运行，**4/4 通过**。生产 HTTP 验证 `/attestations` 与原 `/api/eth-risk` 返回 200，读取报告页后监控仍暂停、事件数为 0。没有启动用户现有 Fork 或要求钱包签名。

**历史阶段尚需钱包验收：** BOT 测试网上的实际部署、MetaMask 签名和实际发布需要用户操作钱包。代码/本地 EVM 通过不代表这些步骤已完成；未填写虚假的测试网合约地址或交易 hash。遵照用户要求，没有进行视觉检查。

## 2026-10-08 主网状态

主网读侧与既有发布交易已通过实际核验；用户交易为PUBLISH，未提供合约创建交易或原报告正文。当前接线与新鲜1050项测试/typecheck/build通过，详情见 [主网验收](bot-mainnet-acceptance.md)。旧968文件可导入保留，不能在677验证其anchor；旧pending保留，禁止新签名或跨链查询，不自动迁移/删除。未重新发送交易或要求钱包签名；NFT合约独立，尚不能把registry当作NFT主网部署证明。
