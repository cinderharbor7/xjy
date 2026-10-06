import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PolicyConfigSchema, PolicyDecisionSchema, RescueProblemSchema, RescueRequestSchema, RescueSessionSchema, VerificationResultSchema } from "@/domain/schemas";

type Media = { example?: unknown; examples?: Record<string, { value: unknown }> };
type Document = {
  paths: Record<string, { post: {
    requestBody: { content: Record<string, Media> };
    responses: Record<string, { content: Record<string, Media> }>;
  } }>;
  components: { schemas: Record<string, { example?: unknown; properties?: Record<string, { items?: Record<string, unknown> }> }> };
};

const load = (name: string): Document => JSON.parse(readFileSync(new URL(`../docs/${name}.openapi.json`, import.meta.url), "utf8"));
const rescue = load("rescue-api");
const endpoint = rescue.paths["/api/rescue"].post;

describe("published OpenAPI contracts", () => {
  it.each(["rescue-api", "position-api"])("has valid JSON and resolvable internal references: %s", (name) => {
    const document = load(name);
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      if ("$ref" in value && typeof value.$ref === "string") {
        expect(value.$ref.startsWith("#/"), "Only internal references are published").toBe(true);
        let target: unknown = document;
        for (const part of value.$ref.slice(2).split("/")) {
          const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
          target = target && typeof target === "object" ? (target as Record<string, unknown>)[key] : undefined;
        }
        expect(target, value.$ref).toBeDefined();
      }
      Object.values(value).forEach(visit);
    }
    visit(document);
  });

  it("publishes schema-valid request and policy preset examples", () => {
    expect(RescueRequestSchema.safeParse(endpoint.requestBody.content["application/json"].example).success).toBe(true);
    expect(PolicyConfigSchema.safeParse(rescue.components.schemas.PolicyConfig.example).success).toBe(true);
  });

  for (const [status, response] of Object.entries(endpoint.responses)) {
    for (const media of Object.values(response.content)) {
      const examples = media.examples ?? { single: { value: media.example } };
      for (const [name, example] of Object.entries(examples)) {
        it(`publishes a schema-valid ${status} / ${name} response example`, () => {
          const result = status === "200" ? RescueSessionSchema.safeParse(example.value) : RescueProblemSchema.safeParse(example.value);
          expect(result.success, JSON.stringify(result.error)).toBe(true);
        });
      }
    }
  }

  it.each(["PolicyDecision", "VerificationResult"])("matches Zod's reason string constraint: %s", (name) => {
    const example = name === "PolicyDecision"
      ? { triggered: false, action: "NONE", reasons: [""] }
      : { status: "SKIPPED", reasons: [""] };
    const schema = name === "PolicyDecision" ? PolicyDecisionSchema : VerificationResultSchema;
    expect(schema.safeParse(example).success).toBe(true);
    const items = rescue.components.schemas[name].properties?.reasons.items;
    expect(items?.type).toBe("string");
    expect(items?.minLength ?? 0).toBe(0);
  });
});
