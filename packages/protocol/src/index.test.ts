import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AbsolutePathSchema,
  CapabilitySchema,
  ErrorCodes,
  InvocationSchema,
  ProtocolError,
  ResourcePathSchema,
  assertInvocationCurrent,
  relativePathFromRoot,
  rootForAbsolutePath
} from "./index.ts";

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "0.1",
    invocationId: "inv_01valididentifier",
    attemptId: "att_01valididentifier",
    accountId: "acct_primary",
    actor: { type: "agent", id: "actor_testagent" },
    target: { projectId: "proj_example" },
    authorization: {
      projectId: "proj_example",
      rootIds: ["root_workspace"],
      grantId: "grant_example"
    },
    tool: "file.read",
    args: { rootId: "root_workspace", path: "src/index.ts" },
    issuedAt: "2026-09-24T00:00:00.000Z",
    expiresAt: "2026-09-24T00:05:00.000Z",
    metadata: { source: "sdk" },
    ...overrides
  };
}

describe("InvocationSchema", () => {
  it("validates committed cross-adapter protocol vectors", async () => {
    const vectors = resolve(fileURLToPath(new URL(".", import.meta.url)), "../vectors");
    const valid = JSON.parse(await readFile(resolve(vectors, "invocation.valid.json"), "utf8"));
    const invalidPath = JSON.parse(
      await readFile(resolve(vectors, "invocation.invalid-path.json"), "utf8")
    );
    const invalidVersion = JSON.parse(
      await readFile(resolve(vectors, "invocation.invalid-version.json"), "utf8")
    );
    expect(InvocationSchema.safeParse(valid).success).toBe(true);
    expect(InvocationSchema.safeParse(invalidPath).success).toBe(false);
    expect(InvocationSchema.safeParse(invalidVersion).success).toBe(false);
  });

  it("accepts a valid resource-relative invocation and applies defaults", () => {
    const parsed = InvocationSchema.parse(invocation());
    expect(parsed.args).toMatchObject({ path: "src/index.ts", maxBytes: 1024 * 1024 });
  });

  it("accepts an absolute device path without exposing a root ID in tool arguments", () => {
    const parsed = InvocationSchema.parse(
      invocation({
        target: { nodeId: "node_macbook" },
        args: { path: "/Users/example/workspace/src/index.ts" }
      })
    );
    expect(parsed.args).toMatchObject({
      path: "/Users/example/workspace/src/index.ts",
      maxBytes: 1024 * 1024
    });
    expect(parsed.args).not.toHaveProperty("rootId");
  });

  it("fails closed on unknown fields and protocol versions", () => {
    expect(() => InvocationSchema.parse(invocation({ unexpected: true }))).toThrow();
    expect(() => InvocationSchema.parse(invocation({ schemaVersion: "0.2" }))).toThrow();
  });

  it("requires an idempotency key for side effects", () => {
    const input = invocation({
      tool: "file.write",
      args: { rootId: "root_workspace", path: "src/out.ts", content: "ok" }
    });
    expect(() => InvocationSchema.parse(input)).toThrow(/idempotencyKey/);
    expect(
      InvocationSchema.parse({ ...input, idempotencyKey: "write-index-v1" }).idempotencyKey
    ).toBe("write-index-v1");
  });

  it("accepts namespaced MCP tools and requires an idempotency key", () => {
    const custom = invocation({
      target: { nodeId: "node_macbook" },
      tool: "mcp.github.search_issues.1234abcd",
      args: { query: "is:open" }
    });
    expect(InvocationSchema.safeParse(custom).success).toBe(false);
    expect(InvocationSchema.parse({ ...custom, idempotencyKey: "github-search-v1" })).toMatchObject(
      {
        tool: "mcp.github.search_issues.1234abcd",
        args: { query: "is:open" }
      }
    );
  });

  it("rejects absolute, traversal, backslash and ambiguous paths", () => {
    for (const path of ["/etc/passwd", "../secret", "src/../secret", "src\\secret", "src//x"]) {
      expect(ResourcePathSchema.safeParse(path).success, path).toBe(false);
    }
  });

  it("validates absolute paths and resolves the most specific advertised folder", () => {
    for (const path of ["relative/file", "/tmp/../etc", "/tmp//file", "/tmp\\file", "/tmp/"]) {
      expect(AbsolutePathSchema.safeParse(path).success, path).toBe(false);
    }
    expect(AbsolutePathSchema.safeParse("/").success).toBe(true);
    expect(AbsolutePathSchema.safeParse("/Users/example/workspace/file.txt").success).toBe(true);
    const root = rootForAbsolutePath("/Users/example/workspace/src/index.ts", [
      { rootId: "root_device", path: "/" },
      { rootId: "root_home", path: "/Users/example" },
      { rootId: "root_workspace", path: "/Users/example/workspace" }
    ]);
    expect(root?.rootId).toBe("root_workspace");
    expect(relativePathFromRoot(root!.path!, "/Users/example/workspace/src/index.ts")).toBe(
      "src/index.ts"
    );
  });

  it("rejects mixed absolute and legacy root path arguments", () => {
    expect(
      InvocationSchema.safeParse(
        invocation({ args: { rootId: "root_workspace", path: "/workspace/file.txt" } })
      ).success
    ).toBe(false);
  });

  it("treats expiration as a stable protocol error", () => {
    const parsed = InvocationSchema.parse(invocation());
    expect(() => assertInvocationCurrent(parsed, new Date("2026-09-24T00:06:00.000Z"))).toThrow(
      ProtocolError
    );
    try {
      assertInvocationCurrent(parsed, new Date("2026-09-24T00:06:00.000Z"));
    } catch (error) {
      expect((error as ProtocolError).code).toBe(ErrorCodes.EXPIRED);
    }
  });
});

describe("CapabilitySchema", () => {
  it("accepts a dynamic MCP tool with its original object schema", () => {
    const capability = CapabilitySchema.parse({
      schemaVersion: "0.1",
      nodeId: "node_macbook",
      tools: [
        {
          name: "mcp.github.search_issues.1234abcd",
          version: "1.0.0",
          risk: "execute",
          sandboxProfiles: ["full-trust"],
          description: "Search issues",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false
          },
          provider: {
            kind: "mcp",
            providerId: "github",
            providerName: "GitHub",
            sourceToolName: "search_issues"
          }
        }
      ],
      roots: [],
      platform: "darwin",
      nodeVersion: "0.1.0",
      advertisedAt: "2026-09-24T00:00:00.000Z"
    });
    expect(capability.tools[0]?.inputSchema).toMatchObject({ type: "object" });
  });

  it("rejects custom tools without provider metadata or execute risk", () => {
    const base = {
      schemaVersion: "0.1",
      nodeId: "node_macbook",
      roots: [],
      platform: "darwin",
      nodeVersion: "0.1.0",
      advertisedAt: "2026-09-24T00:00:00.000Z"
    };
    expect(
      CapabilitySchema.safeParse({
        ...base,
        tools: [
          {
            name: "mcp.github.search_issues.1234abcd",
            version: "1.0.0",
            risk: "read",
            sandboxProfiles: ["full-trust"],
            inputSchema: { type: "object" }
          }
        ]
      }).success
    ).toBe(false);
  });
});
