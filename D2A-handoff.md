# D → A 交接说明：Fork 读侧数据与执行上下文

日期：2026-10-07

## 1. 交接目标

D 正在接入本机 Anvil Fork 的 Guardian 流程：

```text
读侧 Portfolio / Market
  → Risk
  → Investigation
  → Policy
  → Fork Execution
  → 独立读取 after
  → Verification
```

本次交接只冻结 A 提供的余额、钱包和行情读取口径，不改变公共 `PolicyDecision`、`ExecutionAdapter` 或 `ExecutionResult` schema。

当前范围是固定一个本机测试钱包，使用 WETH → USDC 的单跳 Uniswap V2 交易。不能据此声称支持真实主网自动交易或多钱包授权。

## 2. 已确认的共同决策

### 2.1 钱包关系

以下三个地址必须是同一个地址，比较时忽略大小写：

```text
请求钱包 = 受保护钱包 = Fork 签名钱包
```

原因是当前执行适配器会读取受保护钱包的余额，并使用同一钱包签名 approve 和 swap。当前版本不支持 guardian 代替另一个用户钱包执行。

A 的读侧必须拒绝或明确报告读取了其他钱包的情况。D 会在 HTTP 层继续校验请求钱包，并在执行前再次校验 Portfolio 的 `wallet`。

### 2.2 ETH 与 WETH

页面和公共业务合同中可以继续使用逻辑资产名 `ETH`，但在 Fork 读写层：

```text
ETH 逻辑资产 = WETH ERC20
```

A 必须读取：

```text
WETH.balanceOf(protectedWallet)
USDC.balanceOf(protectedWallet)
```

不能使用原生 ETH 余额作为可交易风险资产余额。原生 ETH 只用于支付 gas。

Portfolio 中的 ETH 条目应类似：

```ts
{
  symbol: "ETH",
  tokenAddress: WETH_ADDRESS,
  amount: wethBalance,
  usdValue: wethBalance * ethPrice,
  category: "RISK"
}
```

USDC 条目使用 USDC 合约地址和 USDC ERC20 余额。

### 2.3 行情来源

当前 Fork 范围只需要 WETH/USDC 单跳 Uniswap V2 池的 spot quote：

```text
ETH price = USDC reserve / WETH reserve
```

需要正确处理 token0/token1 顺序，并检查：

- pair 存在；
- 两边储备均可用；
- 价格为有限正数；
- 代币地址与当前链配置一致。

当前 `priceChange5mPct`、`priceChange1hPct` 和 `volatilityScore` 仍属于演示输入，不应描述为 A 已提供的实时风险模型。除非 A/B 另行交付真实行情和风险信号，否则 D 会继续明确标记为 demo/synthetic。

### 2.4 快照与执行上下文

D 在装配时建立一次 `RescueOrchestrator`：

1. 读取一次 `before Portfolio`；
2. 读取一次 `MarketState`；
3. 完成 Risk、Investigation 和 Policy；
4. 将本次 `before` 与 `market` 的副本注入执行适配器；
5. 执行器使用冻结快照计算批准金额；
6. 执行后重新读取 Portfolio 作为 `after`。

执行器可以在广播前实时读取以下链上数据作安全检查：

```text
WETH balance
allowance
Router quote
chain id
```

但不能使用新的余额或新的市场价格重新计算本次 Policy 已批准的减仓比例。否则批准和实际执行可能使用不同价格，导致验证结果失真。

## 3. A 需要提供或确认的内容

请 A 逐项确认以下内容：

1. Portfolio 读取接口或 Adapter 的实际文件位置。
2. 读侧钱包是否强制绑定到受保护钱包。
3. ETH 条目是否读取 WETH ERC20 balance。
4. ETH 条目的 `tokenAddress` 是否为 WETH 地址。
5. USDC 余额和 decimals 是否按链上 ERC20 读取。
6. 行情是否来自当前 Fork 的 WETH/USDC V2 pair。
7. pair 不存在、储备为零、价格无效时的错误类型。
8. 返回的 `blockNumber` 和 `timestamp` 的来源。
9. Portfolio 和 Market 是否可以在同一观察周期内读取。
10. 读侧在 RPC 失败、错链、数据异常时是否拒绝返回伪造或旧数据。
11. 是否需要 D 通过接口传入钱包、区块或链配置。
12. A 是否计划提供真实的 5 分钟、1 小时变化和波动率；如果没有，明确由 D/B 继续提供演示输入。

A 不需要负责：

- Policy 判断；
- ExecutionAdapter；
- 签名、approve 或 swap；
- HTTP 路由；
- 事件去重；
- 执行后的验证结论；
- Aave 只读扩展与 Guardian Portfolio 的混接。

## 4. D 负责的装配方式

D 会在 `src/integration/guardian/` 中完成模式选择和服务装配：

```ts
const portfolioService = new PortfolioService(portfolioAdapter);
const marketService = new MarketService(marketAdapter);

const adapter = new ForkExecutionAdapter(
  frozenPolicyConfig,
  forkConfig,
  {
    getPortfolio: () => frozenBefore,
    getMarketState: () => frozenMarket,
  },
);

const orchestrator = new RescueOrchestrator({
  portfolioService,
  marketService,
  riskService,
  investigationService,
  policyService,
  executionService,
});
```

A 的 Adapter 不应直接调用 Executor，也不应绕过 PortfolioService 或 MarketService 改写公共合同。

## 5. 失败和安全语义

以下情况必须停止当前流程，不得用旧数据或 Mock 数据补齐：

- 钱包与受保护钱包不一致；
- RPC 不在预期 Fork；
- chain id 不一致；
- WETH/USDC pair 不存在；
- 储备或价格无效；
- WETH 或 USDC 读取失败；
- 区块或时间戳不可验证；
- after 重读失败。

交易广播后收据未知时：

```text
事件保持占用；
保存已知交易 hash；
只查询原 hash；
禁止自动重新广播。
```

当前不修改公共 `ExecutionResult` 增加 `PENDING` 状态。待确认状态由 D 的持久化事件记录表达：

```text
GuardianEvent.status = "SUBMITTED_UNKNOWN"
```

## 6. 验收标准

### 6.1 读侧单元验收

至少覆盖：

- 读取 WETH 而不是原生 ETH；
- 返回的 ETH 条目带 WETH 地址；
- 钱包不匹配时拒绝；
- 地址大小写不同仍能正确匹配；
- WETH 为零但 pair 价格有效时仍能返回行情；
- pair 不存在或储备异常时失败；
- 错链或 RPC 失败时不返回伪造数据；
- Portfolio 的总值、风险资产值和风险敞口通过公共 schema 校验。

### 6.2 D 集成验收

在本机 Anvil Fork 上完成：

```text
读取受保护钱包的 WETH/USDC
→ Risk/Policy 触发
→ Fork approve/swap
→ 独立读取 after
→ Verification PASSED 或明确 FAILED
```

同时验证：

- 同一风险事件持续超标不会重复 swap；
- 暂停和恢复不会清除事件占用；
- 进程重启后能恢复已有事件；
- 已提交但未确认的交易不会重新广播；
- Fork 实例变化后不会复用旧事件状态；
- HTTP 路由能够完整驱动上述流程。

## 7. 当前已知限制

- 当前只验证本机 Anvil Fork，不代表主网可用。
- 当前只支持 WETH → USDC 单跳 Uniswap V2。
- 风险变化和调查仍可能使用演示输入。
- `submissions()` 是执行适配器内存记录，不能作为重启恢复依据；持久状态由 D 的 SQLite event journal 保存。
- HTTP → orchestrator → Fork → after → verification 的完整流程尚未完成最终验收。
- Aave 只读扩展不等于 Guardian 已接入真实 Portfolio。

## 8. 请 A 回复

请按以下格式逐项回复：

```text
1. WETH balance 作为 ETH 逻辑资产余额：同意 / 需调整
2. 读侧钱包必须等于受保护钱包：同意 / 需调整
3. ETH tokenAddress 使用 WETH：同意 / 需调整
4. 行情使用 WETH/USDC V2 spot quote：同意 / 需调整
5. Portfolio 与 Market 的接口和文件位置：
6. blockNumber/timestamp 的来源：
7. 失败情况和错误类型：
8. 是否提供真实 5m/1h/volatility：
9. 计划提交的代码和测试：
10. 当前无法覆盖的限制：
```

在 A 完成确认并交付读侧测试前，D 不会把 Fork HTTP 全流程标记为已验收。
