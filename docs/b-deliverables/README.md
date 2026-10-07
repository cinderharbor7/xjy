# B 交付物索引

> 角色：B（方法与解释）
> 日期：2026-10-07
> 基线：main `7d6ceec`

---

## 交付清单

| 文件 | 内容 | 对应冲刺计划 |
|---|---|---|
| [method-card.md](./method-card.md) | 分析方法卡：事实/解释/未知项结构、Risk Score 与 Confidence 计算、标准未知项、方法边界 | P-003：可复查的调查演示 |
| [ai-benchmark.md](./ai-benchmark.md) | 两个真实项目输出与待执行对照；原搜索/计时证据未附，不声明优势 | P-003：通用 AI 对照待验证 |

---

## 快速验证

B 的交付物为**纯文档**，不修改源码。验证方式：

1. 阅读 `method-card.md`，确认：
   - 方法边界与冻结方案一致（单池、未校准、无 LLM）
   - 标准未知项完整（4 条）
   - 与代码实现一致（`sell-pressure.ts`、`onchain-investigation.adapter.ts`）

2. 阅读 `ai-benchmark.md`，确认：
   - 两个案例来自已有验收记录（transaction-check.md）
   - 项目侧引用 A 的完整输出；通用 AI 原始记录和制作＋复核计时仍待补
   - 不把估算、搜索未命中或示意报告写成实测增益；AC-006 未验收
   - Agent 缺口明确披露

---

## 与源码的对应关系

| 文档章节 | 对应源码 | 验证方式 |
|---|---|---|
| Risk Score 计算 | `src/modules/risk/risk.service.ts` | `pnpm test` 中 risk.test.ts |
| 卖压 uplift | `src/modules/risk/sell-pressure.ts` | `pnpm test` 中 onchain-analysis.test.ts |
| Confidence 计算 | `src/modules/investigation/onchain-investigation.adapter.ts` | `pnpm test` 中 onchain-analysis.test.ts |
| 调查输出 | `src/modules/investigation/onchain-investigation.adapter.ts` | `pnpm test` 中 onchain-analysis.test.ts |
| 交易核验 | `src/modules/transaction-check/transaction-check.service.ts` | `pnpm test` 中 transaction-check-service.test.ts |

---

本目录由 B 创建，本地集成校正证据口径。D 可引用方法和项目已验证事实；尚未实测的 AI 对照与增益不得进入成果声明。
