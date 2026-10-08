import { OnchainReportRequestSchema, OnchainReportSchema } from "@/integration/onchain-report.contracts";
import { generateOnchainReport, ReportModeRemovedError } from "@/integration/onchain-report";
import { assertLocalRequest } from "@/integration/guardian/http";
import { isGuardianError } from "@/integration/guardian/contracts";
import { EthereumReadError } from "@/modules/onchain/read-error";

const problems = {
  INVALID_REQUEST: [400, "请提交有效钱包地址 wallet 和 RULES / AI 调查模式；不接受其他字段。"],
  LOCAL_ONLY: [403, "本 MVP 仅允许从配置的本机服务访问。"],
  ORIGIN_REJECTED: [403, "请从当前本机页面发起同源查询。"],
  JSON_REQUIRED: [415, "请求必须使用 application/json。"],
  CONFIGURATION_ERROR: [503, "请在服务器配置有效的 ETHEREUM_RPC_URL。"],
  INVALID_WALLET: [400, "请输入完整的 Ethereum 钱包地址。"],
  INVALID_ARGUMENT: [400, "查询参数无效。"],
  UNSUPPORTED_NETWORK: [503, "RPC 不是 Ethereum 主网（chain id 1），已停止调查。"],
  INVALID_CHAIN_DATA: [503, "链上观察无法一致核验，未生成报告。"],
  STALE_PRICE: [503, "Chainlink 报价已过期，未生成报告。"],
  REORG_DETECTED: [503, "读取期间区块发生变化，未生成报告。"],
  EMPTY_BASELINE: [503, "前一个五分钟窗口没有有效卖出基线，不能计算异常倍数，未生成报告。"],
  RPC_READ_FAILED: [503, "RPC 读取失败，未生成报告；不会用旧数据或 Mock 补齐。请检查配置后手动查询。"],
  AI_MODE_REMOVED: [410, "内置模型调用已移除。请打开 /report，由外部 Agent 通过 WebMCP 完成调查。"],
} as const;
function problem(code: keyof typeof problems) {
  const [status, detail] = problems[code];
  return Response.json({ type: `urn:xjy:onchain-analysis:${code}`, title: "链上调查未完成", status, code, detail,
    instance: "/api/onchain-analysis" }, { status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/problem+json" } });
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return problem("JSON_REQUIRED");
    let input: unknown;
    try { input = await request.json(); } catch { return problem("INVALID_REQUEST"); }
    const parsed = OnchainReportRequestSchema.safeParse(input);
    if (!parsed.success) return problem("INVALID_REQUEST");
    if (parsed.data.investigationMode === "AI") return problem("AI_MODE_REMOVED");
    const report = OnchainReportSchema.safeParse(await generateOnchainReport(parsed.data));
    if (!report.success || report.data.portfolio.state.wallet.toLowerCase() !== parsed.data.wallet.toLowerCase()
      || report.data.investigationMode !== parsed.data.investigationMode) return problem("INVALID_CHAIN_DATA");
    return Response.json(report.data, { headers: { "Cache-Control": "no-store", "X-Onchain-Mode": "LIVE_READ_ONLY" } });
  } catch (error) {
    if (error instanceof EthereumReadError || error instanceof ReportModeRemovedError) return problem(error.code);
    if (isGuardianError(error) && ["LOCAL_ONLY", "ORIGIN_REJECTED", "JSON_REQUIRED"].includes(error.code))
      return problem(error.code as "LOCAL_ONLY" | "ORIGIN_REJECTED" | "JSON_REQUIRED");
    return problem("RPC_READ_FAILED");
  }
}
