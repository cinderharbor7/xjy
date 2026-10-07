import { z } from "zod";

// Aave-specific contracts belong to this optional reader, never the Guardian core.
export const WalletSchema = z.string().trim().min(1);
export const AavePositionStateSchema = z.strictObject({
  wallet: WalletSchema,
  collateralUsd: z.number().finite().nonnegative(),
  debtUsd: z.number().finite().nonnegative(),
  healthFactor: z.number().finite().nonnegative(),
  ethPrice: z.number().finite().positive(),
  timestamp: z.iso.datetime(),
  blockNumber: z.number().int().nonnegative().optional(),
});

export const EthereumAddressSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid Ethereum address.");
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const block = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const PositionQuerySchema = z.strictObject({ wallet: EthereumAddressSchema });

export const PositionEvidenceSchema = z.strictObject({
  chainId: z.literal(1),
  network: z.literal("ethereum-mainnet"),
  protocol: z.literal("aave-v3"),
  providerAddress: EthereumAddressSchema,
  poolAddress: EthereumAddressSchema,
  oracleAddress: EthereumAddressSchema,
  ethAssetAddress: EthereumAddressSchema,
  blockNumber: block,
  blockHash: hash,
  blockTimestamp: z.iso.datetime(),
  txHash: hash.optional(),
});

export const PositionMarketChangesSchema = z.strictObject({
  ethChangePct: z.number().finite(),
  previousEthPrice: z.number().finite().positive(),
  referenceBlockNumber: block,
  referenceBlockHash: hash,
  referenceTimestamp: z.iso.datetime(),
  referenceOracleAddress: EthereumAddressSchema,
  lookbackBlocks: z.number().int().positive(),
  lookbackSeconds: z.number().int().positive(),
});

const common = { mode: z.literal("LIVE"), wallet: EthereumAddressSchema, evidence: PositionEvidenceSchema };

export const PositionSnapshotSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...common, status: z.literal("ACTIVE"), position: AavePositionStateSchema, marketChanges: PositionMarketChangesSchema }),
  z.strictObject({ ...common, status: z.literal("NO_DEBT"), position: z.null(), message: z.string().min(1) }),
]).superRefine((snapshot, context) => {
  if (snapshot.status !== "ACTIVE") return;
  const { position, evidence, marketChanges } = snapshot;
  const consistent = position.debtUsd > 0
    && position.wallet === snapshot.wallet
    && position.blockNumber === evidence.blockNumber
    && position.timestamp === evidence.blockTimestamp
    && marketChanges.referenceBlockNumber < evidence.blockNumber
    && evidence.blockNumber - marketChanges.referenceBlockNumber === marketChanges.lookbackBlocks
    && Date.parse(evidence.blockTimestamp) - Date.parse(marketChanges.referenceTimestamp) === marketChanges.lookbackSeconds * 1000;
  if (!consistent) context.addIssue({ code: "custom", message: "Position, market window and evidence must describe the same wallet and block." });
});

export const PositionProblemSchema = z.strictObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.union([z.literal(400), z.literal(502), z.literal(503)]),
  detail: z.string().min(1),
  instance: z.literal("/api/position"),
  code: z.enum(["INVALID_WALLET", "CONFIGURATION_ERROR", "UNSUPPORTED_NETWORK", "INVALID_CHAIN_DATA", "RPC_READ_FAILED"]),
});
