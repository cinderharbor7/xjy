# 团队集成验收：A/B/C/D

日期：2026-10-07（Asia/Shanghai）。集成分支 `codex/integrate-guardian`，共同基线 `bc1d504`。纳入 A `f14699e`、B `21eab08`、C `c062479`、D `dba34bf`（执行实现 `eef9e09`）。保留各分支提交历史；用户确认后，[PR #3](https://github.com/cinderharbor7/xjy/pull/3) 于 `2026-10-07T11:53:48+08:00` 合入 main，合并提交 `3d264a2`。

## 新鲜工程检查

- `pnpm install --frozen-lockfile`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：**769 passed，2 skipped；30 passing files，1 skipped file**。
- `pnpm build`：通过；首页、risk-lab、position及五个 API入口正常生成。
- `git diff --check`：通过。
- 独立审查覆盖 A/B只读组合、Fork canonical读取、冻结金额、receipt时间、Policy权限、lease/journal和验收子进程隔离；发现的问题已修复并新增回归测试。

跳过的是 C 的 `tests/fork-integration.test.ts` 中两个需显式设置 `FORK_RPC_URL` 的用例。它们未被计为通过；下面记录的完整 HTTP/Fork验收是另外实际运行的脚本。

## 默认启动与 Mock HTTP

真实执行 `pnpm dev --port 3118` 和 `pnpm start --port 3108`；`lsof`确认两者只监听 `127.0.0.1`。使用各自独立 `.guardian/` SQLite文件，未修改已有3000服务或用户事件状态。验证后停止本次测试进程。

生产HTTP验收时间 `2026-10-07T03:27:43.731Z`：首页、`/risk-lab`、`/position`均200；默认MOCK/暂停；同源rescue200，Risk91/Confidence0.88，敞口100%→70%，verification PASSED。重复调用409、外国Origin403、请求偷偷添加action400。没有真实链上交易。

## Computer use 浏览器验收

同日使用 Codex in-app browser 实际操作本地页面；首页以显式 MOCK 模式启动，使用独立 SQLite 验收状态，不删除旧事件。默认 dev 同时提供前端和 API，只监听 `127.0.0.1:3000`。

- 首次 Run rescue loop：Risk91、Confidence88%、Policy批准、Mock ETH→USDC、敞口100%→70%，独立验证PASSED。
- 重复运行：页面提示当前风险事件已占用，HTTP409；未增加执行事件。监控Start/Pause正常，经历多个轮询周期后暂停，刷新保留Paused、同一CONFIRMED事件和救援结果。
- Policy拒绝：另一份独立状态的3001实例把Risk阈值保存为100，刷新保持v2/100；Agent仍建议SWAP_TO_SAFE，但Policy为No action，Execution Skipped，无txHash，Verification SKIPPED。该临时实例验收后已停止。
- `/risk-lab`：MOCK CHAIN FIXTURE、模型与依据正常展示，Refresh fixture正常。
- `/position`：非法地址被前端拒绝；公开测试钱包`0x485c028c475dba482297656229d11b4eaf22357b`真实只读查询返回ACTIVE，展示合同JSON、合约地址、block/hash/time。该次观察块`26137899`，时间`2026-10-07T03:44:23.000Z`，HF约2.5346；这是该区块的结果，不是固定Demo值。

本次浏览器没有执行Fork approve/swap、BOT部署或真实主网交易。Aave只读页面独立于Guardian Mock执行链。原始浏览器报告和截图位于Git忽略的`.guardian/ui-acceptance-20261007-1145/`，团队验收范围以上述记录为准。

## A→B真实主网只读分析

实际执行：

```bash
pnpm --silent data:analyze --wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --json
```

返回 `LIVE_READ_ONLY` / `SELL_PRESSURE_HEURISTIC`，共同锚点区块 `26137802`，区块时间 `2026-10-07T03:24:47.000Z`。原生 ETH+USDC、Chainlink价格与单池信号通过冻结合同交接；同一快照读取，无Policy/签名/Executor调用。

本次读到卖压倍数 `4.300907221617383`，`txCount=8`、`uniqueWallets=8`、`evidence.length=21`，调查中保留交易引用和来源；规则分数 `54`、启发式Confidence `0.78`。这些是本次真实观察结果，不是固定Demo期望或未来报价保证。原始JSON保存在忽略的 `.guardian/ab-analysis.json`。

## 本机Fork完整链路

最新执行完成时间 `2026-10-07T11:31:34.905000+08:00`（原始UTC `2026-10-07T03:31:34.905Z`），Anvil **1.7.1**，独立loopback端口18545/3107，`--block-time 2`，一次性随机签名钱包。Gas与10 WETH只在这次本机Fork设置；私钥仅留在内存/测试进程环境，未写文件或提交Git。只读上游RPC用于Fork状态读取，没有主网广播。

执行的是当前 `scripts/verify-guardian-fork.mjs`。脚本先拒绝已占用端口，再确认自己创建的Anvil监听和自己的Next随机钱包；重启也重新校验服务归属。

| 事件 | 卖出WETH | 收到USDC | 风险敞口 | before→after区块 | 独立验证 |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 3 | 7806.387744 | 100.00000% → 70.04716% | 26137835 → 26137841 | PASSED |
| 2 | 2.9979800914372707 | 7789.345782 | 70.04716% → 40.05600% | 26137866 → 26137869 | PASSED |

本机Fork hashes（不提供主网浏览器链接）：

- `0x22e84e154511a599fc285fbf3005f9903865b7a92abe5c033c43ebc436872bd5`
- `0x257fc74ab3042a5d824dee846919898225484525ee9d6f31c4e50a51a0f2fffa`

覆盖：HTTP保存配置、服务端自动首笔swap、独立after/验证、同一事件持续超标不重卖、手动重复调用409、暂停/恢复保留事件、真正停止/重启Next后保留事件、3次新鲜市场恢复后重新武装、随后第二事件恰好一次swap。approve不计为减仓次数。Portfolio时间来自canonical block；成功执行时间来自receipt block；after块号与时间不倒退。

未知hash只查询不重发、广播前journal失败不得发送、Fork实例变化拒绝复用、失去lease的迟到结果不得回退事件、读取失败不得生成after等异常路径由针对性离线测试覆盖，未声称在这次真实Fork运行中人为制造全部异常。

原始本次报告：`.guardian/acceptance-1791343807993/report.json`（Git忽略）。旧D交付记录仍保留于 `docs/guardian-monitor-acceptance.md`，不与这次统计混用。

## 团队手动验收标准

1. `pnpm install && pnpm dev`启动；页面MOCK标签明确，策略保存后可单次运行或启动服务端监控。
2. 首次Mock展示Risk91/Confidence88%、Policy批准、3ETH→8100USDC、独立重读7ETH/8100USDC，敞口100%→70%，PASSED。
3. 同事件重复运行不能产生第二次swap；暂停/恢复和重启不能重置记录。NONE观察也不能把Mock余额重置为10ETH。
4. `pnpm data:analyze --wallet ADDRESS --json`用有效主网RPC完成只读A→B，查看真实tx/block引用、规则解释和不确定性；失败须明确报错，不能回退Mock。
5. 按 `docs/guardian-monitor.md`配置独立Anvil和一次性测试钱包，在Fork上完成Policy→approve/swap→独立after→PASSED或明确FAILED；未知结果不能重新广播。
6. CI/本地typecheck、test、build通过，跳过用例和实测范围分开报告。

## 当前边界

- A→B的真实分析是单次独立只读入口。监控交易流程仍使用Demo的5m/1h变化、volatility和Mock investigation；真实卖压恢复规则尚待B/D交付，未接入持久化交易循环。
- B的规则分数和Confidence未拟合/校准，也不是下跌概率；没有真实LLM。
- Fork tradable ETH=WETH；主网只读Portfolio统计原生ETH。V3卖压和V2执行来自不同明确范围，不能混为同一池或同一链实例。
- USDC=$1在Fork仍是假设；仅固定一个同签名钱包、WETH→USDC单跳，本机可运行不等于主网自动交易已可用。
- Aave扩展和ResearchLab保留且独立；ResearchLab为MOCK_CHAIN_FIXTURE。没有新增BOT Chain部署或产品范围外功能。
- 浏览器验收覆盖Mock救援、策略拒绝、事件保留、Risk Lab和Aave只读；真实Fork完整流程由另一次独立HTTP/Fork脚本验收。
