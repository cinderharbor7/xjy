import { TransactionCheckProblemSchema, TransactionCheckReportSchema, TransactionCheckRequestSchema, type TransactionCheckProblem } from "@/domain/schemas/transaction-check";
import { checkTransaction } from "@/integration/transaction-check";
import { assertLocalRequest } from "@/integration/guardian/http";
import { isGuardianError } from "@/integration/guardian/contracts";
import { TransactionCheckError } from "@/modules/transaction-check/transaction-check.error";

export const runtime = "nodejs";

// Fixed safe messages. Provider errors can contain credentials; never serialize them.
const problems: Record<TransactionCheckProblem["code"], { status: TransactionCheckProblem["status"]; detail: string }> = {
  INVALID_REQUEST: { status: 400, detail: "请提交 JSON 对象，仅包含完整的 Ethereum 交易哈希 txHash。" },
  LOCAL_ONLY: { status: 403, detail: "本 MVP 仅允许从配置的本机服务访问。" },
  ORIGIN_REJECTED: { status: 403, detail: "请从当前本机页面发起同源查询。" },
  JSON_REQUIRED: { status: 415, detail: "请求必须使用 application/json。" },
  TRANSACTION_NOT_FOUND: { status: 404, detail: "当前 Ethereum 主网 RPC 未找到这笔交易。请核对哈希与网络。" },
  TRANSACTION_PENDING: { status: 409, detail: "这笔交易尚未确认上链，请确认后手动查询。" },
  CONFIGURATION_ERROR: { status: 503, detail: "请在服务器配置有效的 ETHEREUM_RPC_URL；本页面不会用 Mock 数据补齐。" },
  UNSUPPORTED_NETWORK: { status: 503, detail: "RPC 连接的不是 Ethereum 主网（chain id 1），已停止核验。" },
  INVALID_CHAIN_DATA: { status: 503, detail: "交易、回执、区块或交易池数据无法一致核验，未生成结论。" },
  REORG_DETECTED: { status: 503, detail: "核验期间发现区块变化，未生成结论。请稍后手动查询。" },
  RPC_READ_FAILED: { status: 503, detail: "RPC 读取失败，未生成结论。请检查服务配置后手动查询。" },
};

function problem(code: TransactionCheckProblem["code"]) {
  const safe = problems[code];
  return Response.json(TransactionCheckProblemSchema.parse({
    type: `urn:xjy:transaction-check:${code}`, title: "交易核验未完成", code,
    status: safe.status, detail: safe.detail, instance: "/api/transaction-checks",
  }), { status: safe.status, headers: { "Cache-Control": "no-store", "Content-Type": "application/problem+json" } });
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return problem("JSON_REQUIRED");
    let body: unknown;
    try { body = await request.json(); } catch { return problem("INVALID_REQUEST"); }
    const parsed = TransactionCheckRequestSchema.safeParse(body);
    if (!parsed.success) return problem("INVALID_REQUEST");
    const report = TransactionCheckReportSchema.safeParse(await checkTransaction(parsed.data.txHash));
    if (!report.success) return problem("INVALID_CHAIN_DATA");
    return Response.json(report.data, { headers: { "Cache-Control": "no-store", "X-Transaction-Check-Mode": "LIVE_READ_ONLY" } });
  } catch (error) {
    if (error instanceof TransactionCheckError) return problem(error.code);
    if (isGuardianError(error) && ["LOCAL_ONLY", "ORIGIN_REJECTED", "JSON_REQUIRED"].includes(error.code)) {
      return problem(error.code as "LOCAL_ONLY" | "ORIGIN_REJECTED" | "JSON_REQUIRED");
    }
    return problem("RPC_READ_FAILED");
  }
}
