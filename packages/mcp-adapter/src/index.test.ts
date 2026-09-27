import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { ResultSchema, type Invocation } from "@adc/protocol";
import { McpInvocationAdapter, createMcpServer } from "./index.ts";

describe("McpInvocationAdapter", () => {
  it("accepts an absolute path with a device grant and no project", async () => {
    let captured: Invocation | undefined;
    const adapter = new McpInvocationAdapter({
      client: {
        invoke: async (invocation) => {
          captured = invocation;
          return ResultSchema.parse({
            schemaVersion: "0.1",
            invocationId: invocation.invocationId,
            attemptId: invocation.attemptId,
            status: "queued",
            jobId: "job_devicegrant"
          });
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        nodeIds: ["node_macbook"],
        rootAccess: "all",
        resourcesByNode: {
          node_macbook: [{ rootId: "root_newfolder", path: "/Users/example/new-folder" }]
        },
        rootIds: []
      }
    });
    await adapter.invoke("file.read", {
      args: { path: "/Users/example/new-folder/readme.md" }
    });
    expect(captured).toMatchObject({
      target: { nodeId: "node_macbook" },
      args: { path: "/Users/example/new-folder/readme.md" },
      authorization: { rootIds: ["root_newfolder"] },
      metadata: { source: "mcp" }
    });
    expect(captured?.authorization.projectId).toBeUndefined();
  });

  it("submits the same Tool IR used by HTTP and CLI clients", async () => {
    let captured: Invocation | undefined;
    const adapter = new McpInvocationAdapter({
      client: {
        invoke: async (invocation) => {
          captured = invocation;
          return ResultSchema.parse({
            schemaVersion: "0.1",
            invocationId: invocation.invocationId,
            attemptId: invocation.attemptId,
            status: "queued",
            jobId: "job_mcpadapter"
          });
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        projectId: "proj_example",
        rootIds: ["root_workspace"]
      },
      defaultTarget: { projectId: "proj_example" }
    });
    const result = await adapter.invoke("file.write", {
      args: { rootId: "root_workspace", path: "output.txt", content: "ok" },
      idempotencyKey: "mcp-write-once"
    });
    expect(result.status).toBe("queued");
    expect(captured).toMatchObject({
      schemaVersion: "0.1",
      tool: "file.write",
      args: { rootId: "root_workspace", path: "output.txt", content: "ok" },
      idempotencyKey: "mcp-write-once",
      metadata: { source: "mcp" }
    });
  });

  it("creates an official SDK server and applies tool visibility", () => {
    const server = createMcpServer({
      client: {
        invoke: async () => {
          throw new Error("not called");
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        rootIds: ["root_workspace"]
      },
      defaultTarget: { projectId: "proj_example" },
      allowedTools: ["file.read"]
    });
    expect(server).toBeDefined();
  });

  it("deduplicates logical tools and constrains each target to advertising devices", async () => {
    const server = createMcpServer({
      client: {
        invoke: async () => {
          throw new Error("not called");
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        nodeIds: ["node_alpha", "node_beta"],
        toolNodeIds: {
          "file.read": ["node_beta", "node_alpha", "node_alpha"],
          "test.run": ["node_beta"],
          "file.write": []
        },
        rootIds: []
      },
      allowedTools: ["file.read", "file.write", "test.run"]
    });
    const client = new Client({ name: "target-schema-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["file.read", "test.run"]);
      const read = listed.tools.find((tool) => tool.name === "file.read")!;
      const test = listed.tools.find((tool) => tool.name === "test.run")!;
      expect(((read.inputSchema.properties!.target as any).properties.nodeId as any).enum).toEqual([
        "node_alpha",
        "node_beta"
      ]);
      expect(((test.inputSchema.properties!.target as any).properties.nodeId as any).enum).toEqual([
        "node_beta"
      ]);
      expect(read.inputSchema.required).toContain("target");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a device that does not advertise the selected tool before dispatch", async () => {
    const adapter = new McpInvocationAdapter({
      client: {
        invoke: async () => {
          throw new Error("must not dispatch");
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        nodeIds: ["node_alpha", "node_beta"],
        toolNodeIds: { "file.read": ["node_alpha"] },
        resourcesByNode: {
          node_alpha: [{ rootId: "root_alpha", path: "/workspace" }],
          node_beta: [{ rootId: "root_beta", path: "/workspace" }]
        },
        rootIds: ["root_alpha", "root_beta"]
      }
    });
    await expect(
      adapter.invoke("file.read", {
        args: { path: "/workspace/README.md" },
        target: { nodeId: "node_beta" }
      })
    ).rejects.toThrow("does not advertise file.read");
  });

  it("exposes one dynamic MCP tool with its source schema across advertising devices", async () => {
    const toolId = "mcp.github.search.1234abcd";
    let captured: Invocation | undefined;
    const server = createMcpServer({
      client: {
        invoke: async (invocation) => {
          captured = invocation;
          return ResultSchema.parse({
            schemaVersion: "0.1",
            invocationId: invocation.invocationId,
            attemptId: invocation.attemptId,
            status: "queued",
            jobId: "job_customtool"
          });
        }
      },
      context: {
        accountId: "acct_primary",
        actorId: "actor_testagent",
        grantId: "grant_example",
        nodeIds: ["node_alpha", "node_beta"],
        toolNodeIds: { [toolId]: ["node_beta", "node_alpha"] },
        toolDefinitions: {
          [toolId]: {
            name: toolId,
            version: "1.0.0",
            risk: "execute",
            sandboxProfiles: ["full-trust"],
            description: "Search GitHub issues",
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
              sourceToolName: "search"
            }
          }
        },
        rootIds: []
      },
      allowedTools: [toolId]
    });
    const client = new Client({ name: "custom-tool-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0]).toMatchObject({
        name: toolId,
        inputSchema: {
          properties: {
            args: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"]
            },
            target: {
              properties: { nodeId: { enum: ["node_alpha", "node_beta"] } }
            }
          },
          required: ["args", "target", "idempotencyKey"]
        }
      });
      await expect(
        client.callTool({
          name: toolId,
          arguments: {
            args: { query: 42 },
            target: { nodeId: "node_alpha" },
            idempotencyKey: "custom-search-1"
          }
        })
      ).rejects.toThrow();
      await client.callTool({
        name: toolId,
        arguments: {
          args: { query: "is:open" },
          target: { nodeId: "node_beta" },
          idempotencyKey: "custom-search-1"
        }
      });
      expect(captured).toMatchObject({
        tool: toolId,
        args: { query: "is:open" },
        target: { nodeId: "node_beta" },
        idempotencyKey: "custom-search-1"
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
