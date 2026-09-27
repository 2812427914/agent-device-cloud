import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdcClient, NodeApiClient, generateNodeKeyPair } from "../packages/client/src/index.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { createMcpServer } from "../packages/mcp-adapter/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { grantContext } from "../apps/control-plane/src/access.ts";
import { NodeDaemon } from "../apps/node/src/daemon.ts";
import { McpProviderManager, mcpToolId } from "../apps/node/src/mcp-providers.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

const apps: Awaited<ReturnType<typeof createControlPlane>>[] = [];
const directories: string[] = [];
const cookie = "adc.session_token=mcp-provider-e2e";

function fetchFor(app: Awaited<ReturnType<typeof createControlPlane>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const injection: InjectOptions = {
      method: (init?.method ?? "GET") as any,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === "string" ? { payload: init.body } : {})
    };
    const response: LightMyRequestResponse = await app.inject(injection);
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>
    });
  }) as typeof fetch;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("device MCP Provider", () => {
  it("flows from one aggregated Agent tool through ADC to the local MCP server", async () => {
    const store = new MemoryStore();
    const app = await createControlPlane({ store, access: accessFixture({ cookie }) });
    apps.push(app);
    const fetcher = fetchFor(app);
    const owner = new AdcClient("http://adc.test", { cookie }, fetcher);
    const pairing = await owner.createPairingCode();
    const keys = generateNodeKeyPair();
    const paired = await new NodeApiClient(
      "http://adc.test",
      undefined,
      keys.privateKey,
      fetcher
    ).pair({
      code: pairing.code,
      label: "provider-node",
      platform: "darwin",
      publicKey: keys.publicKey
    });
    const providerConfig = {
      providerId: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "unused-in-test",
      args: [],
      env: {}
    };
    const inputSchema = {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    };
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "issue-42" }],
      structuredContent: { issue: 42 }
    });
    const providers = new McpProviderManager(
      async () => ({
        listTools: async () => ({
          tools: [
            {
              name: "search",
              description: "Search GitHub issues",
              inputSchema
            }
          ]
        }),
        callTool,
        close: async () => {}
      }),
      60_000
    );
    const stateDirectory = await mkdtemp(resolve(tmpdir(), "adc-mcp-provider-e2e-"));
    directories.push(stateDirectory);
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://adc.test",
      nodeId: paired.nodeId,
      privateKey: keys.privateKey,
      roots: [],
      accessMode: "none",
      stateDirectory,
      mcpProviders: [providerConfig],
      mcpProviderManager: providers,
      fetcher
    });
    expect(await daemon.runOnce()).toBe(false);

    const tool = mcpToolId("github", "search", inputSchema);
    const grant = {
      grantId: "grant_custom",
      actorId: "actor_custom",
      name: "Custom Agent",
      profile: "workspace-write" as const,
      nodeIds: [paired.nodeId],
      rootAccess: "selected" as const,
      rootIds: [],
      approvalPolicy: "never" as const,
      allowedTools: [tool]
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/grants",
      headers: { cookie, origin: "http://adc.test" },
      payload: grant
    });
    expect(created.statusCode).toBe(200);

    const savedGrant = (await store.getGrant(grant.grantId))!;
    const mcpServer = createMcpServer({
      client: owner,
      context: grantContext(savedGrant, await store.listNodes("acct_primary")),
      allowedTools: savedGrant.allowedTools
    });
    const agent = new Client({ name: "e2e-agent", version: "0.1.0" });
    const [agentTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await agent.connect(agentTransport);
    try {
      const listed = await agent.listTools();
      expect(listed.tools.map((entry) => entry.name)).toEqual([tool]);
      const response = await agent.callTool({
        name: tool,
        arguments: {
          args: { query: "is:open" },
          target: { nodeId: paired.nodeId },
          idempotencyKey: "provider-e2e-call"
        }
      });
      const queued = response.structuredContent as { status: string; jobId: string };
      expect(queued.status).toBe("queued");

      expect(await daemon.runOnce()).toBe(true);
      await expect(owner.taskStatus(queued.jobId)).resolves.toMatchObject({
        status: "succeeded",
        output: {
          content: [{ type: "text", text: "issue-42" }],
          structuredContent: { issue: 42 }
        },
        receipt: { tool, sideEffect: true }
      });
      expect(callTool).toHaveBeenCalledWith(
        { name: "search", arguments: { query: "is:open" } },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    } finally {
      await agent.close();
      await mcpServer.close();
      await providers.close();
    }
  });
});
