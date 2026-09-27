import { describe, expect, it } from "vitest";
import type { AgentGrantRecord, NodeRecord } from "@adc/db";
import { CapabilitySchema, type ToolId } from "@adc/protocol";
import { grantContext } from "./access.ts";

const createdAt = "2026-09-27T00:00:00.000Z";

function node(nodeId: string, tools: ToolId[]): NodeRecord {
  return {
    nodeId,
    accountId: "acct_primary",
    label: nodeId,
    publicKey: "public-key",
    platform: "darwin",
    status: "active",
    capability: CapabilitySchema.parse({
      schemaVersion: "0.1",
      nodeId,
      tools: tools.map((name) =>
        name.startsWith("mcp.")
          ? {
              name,
              version: "1.0.0",
              risk: "execute",
              sandboxProfiles: ["full-trust"],
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } }
              },
              provider: {
                kind: "mcp",
                providerId: "github",
                providerName: "GitHub",
                sourceToolName: "search"
              }
            }
          : {
              name,
              version: "0.1.0",
              risk: name === "file.read" ? "read" : name === "file.write" ? "write" : "execute",
              sandboxProfiles: ["restricted-process"]
            }
      ),
      roots: [],
      platform: "darwin",
      nodeVersion: "0.1.0",
      advertisedAt: createdAt
    }),
    createdAt
  };
}

describe("grantContext", () => {
  it("groups duplicate and machine-specific capabilities by logical tool", () => {
    const grant: AgentGrantRecord = {
      grantId: "grant_example",
      accountId: "acct_primary",
      actorId: "actor_example",
      profile: "workspace-write",
      nodeIds: ["node_beta", "node_alpha"],
      rootIds: [],
      allowedTools: ["file.read", "file.write", "test.run"],
      createdAt
    };

    expect(
      grantContext(grant, [
        node("node_alpha", ["file.read", "file.write"]),
        node("node_beta", ["file.read", "test.run"]),
        node("node_ungranted", ["file.read", "file.write", "test.run"])
      ]).toolNodeIds
    ).toEqual({
      "file.read": ["node_alpha", "node_beta"],
      "file.write": ["node_alpha"],
      "test.run": ["node_beta"]
    });
  });

  it("deduplicates the same custom tool definition while retaining all providers", () => {
    const tool = "mcp.github.search.1234abcd";
    const unique = "mcp.github.unique.87654321";
    const grant: AgentGrantRecord = {
      grantId: "grant_example",
      accountId: "acct_primary",
      actorId: "actor_example",
      profile: "workspace-write",
      nodeIds: ["node_beta", "node_alpha", "node_unique"],
      rootIds: [],
      allowedTools: [tool, unique],
      createdAt
    };
    const context = grantContext(grant, [
      node("node_alpha", [tool]),
      node("node_beta", [tool]),
      node("node_unique", [unique])
    ]);
    expect(context.toolNodeIds).toEqual({
      [tool]: ["node_alpha", "node_beta"],
      [unique]: ["node_unique"]
    });
    expect(context.toolDefinitions[tool]).toMatchObject({
      name: tool,
      provider: { providerId: "github", sourceToolName: "search" }
    });
  });
});
