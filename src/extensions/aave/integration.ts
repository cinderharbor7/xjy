import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { PositionQuerySchema, PositionSnapshotSchema } from "./schemas";
import type { PositionSnapshot } from "./types";
import { AavePositionAdapter } from "./aave-position.adapter";
import { PositionReadError } from "./position-read.error";

/** Read-only composition root. It never instantiates a wallet or rescue executor. */
export function createAavePositionAdapter(): AavePositionAdapter {
  if ((process.env.AAVE_NETWORK ?? "ethereum-mainnet") !== "ethereum-mainnet") {
    throw new PositionReadError("CONFIGURATION_ERROR", "Set AAVE_NETWORK=ethereum-mainnet. This reader supports only Aave V3 Ethereum Core.");
  }
  const rpcUrl = process.env.ETHEREUM_RPC_URL?.trim();
  let parsed: URL;
  try {
    if (!rpcUrl) throw new Error();
    parsed = new URL(rpcUrl);
  } catch {
    throw new PositionReadError("CONFIGURATION_ERROR", "Set ETHEREUM_RPC_URL to an HTTP(S) Ethereum mainnet RPC with historical read support.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PositionReadError("CONFIGURATION_ERROR", "ETHEREUM_RPC_URL must use HTTP or HTTPS.");
  }
  return new AavePositionAdapter(createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }),
  }));
}

export async function getAavePositionSnapshot(wallet: string): Promise<PositionSnapshot> {
  const query = PositionQuerySchema.parse({ wallet });
  return PositionSnapshotSchema.parse(await createAavePositionAdapter().getSnapshot(query.wallet));
}
