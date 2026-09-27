import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { McpProviderManager, mcpToolId } from "./mcp-providers.ts";

const inputSchema = {
  type: "object" as const,
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false
};

describe("McpProviderManager", () => {
  it("uses a stable namespaced ID and forwards calls to the source tool", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "result" }]
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const connector = vi.fn().mockResolvedValue({
      listTools: async () => ({
        tools: [
          {
            name: "Search Issues",
            title: "Search",
            description: "Search provider issues",
            inputSchema
          }
        ]
      }),
      callTool,
      close
    });
    const manager = new McpProviderManager(connector, 60_000);
    await manager.update([
      {
        providerId: "github",
        name: "GitHub",
        transport: "stdio",
        command: "github-mcp",
        args: [],
        env: {}
      }
    ]);

    const expectedId = mcpToolId("github", "Search Issues", inputSchema);
    expect(manager.capabilities()).toEqual([
      expect.objectContaining({
        name: expectedId,
        risk: "execute",
        inputSchema,
        provider: {
          kind: "mcp",
          providerId: "github",
          providerName: "GitHub",
          sourceToolName: "Search Issues"
        }
      })
    ]);
    await expect(manager.execute(expectedId, { query: "is:open" })).resolves.toMatchObject({
      succeeded: true,
      output: { content: [{ type: "text", text: "result" }] }
    });
    expect(callTool).toHaveBeenCalledWith(
      { name: "Search Issues", arguments: { query: "is:open" } },
      undefined
    );

    await manager.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("changes the public ID when the provider contract changes", () => {
    expect(mcpToolId("github", "search", inputSchema)).not.toBe(
      mcpToolId("github", "search", {
        ...inputSchema,
        required: []
      })
    );
  });

  it("removes capabilities and closes a provider after config removal", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const manager = new McpProviderManager(
      async () => ({
        listTools: async () => ({
          tools: [{ name: "search", inputSchema }]
        }),
        callTool: async () => ({ content: [] }),
        close
      }),
      60_000
    );
    await manager.update([
      {
        providerId: "github",
        name: "GitHub",
        transport: "http",
        url: "https://mcp.example.com",
        headers: {}
      }
    ]);
    expect(manager.capabilities()).toHaveLength(1);

    await manager.update([]);
    expect(manager.capabilities()).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("discovers and calls a real stdio MCP server", async () => {
    const manager = new McpProviderManager();
    const fixture = fileURLToPath(
      new URL("../../../tests/fixtures/mcp-provider-server.ts", import.meta.url)
    );
    try {
      await manager.update([
        {
          providerId: "local",
          name: "Local fixture",
          transport: "stdio",
          command: process.execPath,
          args: ["--import", "tsx", fixture],
          env: {}
        }
      ]);
      const [tool] = manager.capabilities();
      expect(tool).toMatchObject({
        name: expect.stringMatching(/^mcp\.local\.echo\.[a-f0-9]{8}$/),
        provider: { sourceToolName: "echo" }
      });
      await expect(manager.execute(tool!.name, { message: "hello" })).resolves.toMatchObject({
        succeeded: true,
        output: {
          content: [{ type: "text", text: "local:hello" }],
          structuredContent: { message: "local:hello" }
        }
      });
    } finally {
      await manager.close();
    }
  });
});
