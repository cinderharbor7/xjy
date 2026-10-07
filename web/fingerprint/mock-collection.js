import { z } from "zod";

export const MOCK_COLLECTION_KEY = "cfp.collection.mock.v1";
const RecordSchema = z.strictObject({
  id: z.uuid(),
  mode: z.literal("MOCK"),
  onchain: z.literal(false),
  metadata: z.object({
    name: z.string().min(1),
    image: z.string().startsWith("data:image/svg+xml;base64,"),
    properties: z.object({
      symbol: z.string().min(1),
      capturedAt: z.iso.datetime(),
      sourceMode: z.enum(["demo", "live", "stale", "unavailable"]),
    }).passthrough(),
  }).passthrough(),
});
const RecordsSchema = z.array(RecordSchema);

export function mockCollections() {
  try {
    const raw = localStorage.getItem(MOCK_COLLECTION_KEY);
    return raw === null ? [] : RecordsSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Mock 收藏无法读取；浏览器存储不可用或记录损坏，未清空原记录。");
  }
}

export function saveMockCollection(edition) {
  const record = RecordSchema.parse({
    id: crypto.randomUUID(), mode: "MOCK", onchain: false,
    metadata: structuredClone(edition.metadata),
  });
  const raw = JSON.stringify([record, ...mockCollections()]);
  try {
    localStorage.setItem(MOCK_COLLECTION_KEY, raw);
    if (localStorage.getItem(MOCK_COLLECTION_KEY) !== raw) throw new Error("Storage mismatch");
  } catch {
    throw new Error("Mock 收藏未能确认保存，请检查浏览器本地存储；没有发起链上交易。");
  }
  return record;
}
