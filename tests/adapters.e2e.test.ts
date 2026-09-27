import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { AdcClient, NodeApiClient, generateNodeKeyPair } from "../packages/client/src/index.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { CapabilitySchema } from "../packages/protocol/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

const execFileAsync = promisify(execFile);
const cleanup: Array<() => Promise<void>> = [];
const cookie = "adc.session_token=adapter-session";
const agentToken = "adapter-agent-token";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()));
});

describe("adapter parity", () => {
  it("routes CLI and official MCP SDK calls through the same policy and dispatch path", async () => {
    const store = new MemoryStore();
    const access = accessFixture({
      cookie,
      agents: { [agentToken]: { accountId: "acct_primary", grantId: "grant_example" } }
    });
    const app = await createControlPlane({
      store,
      access
    });
    cleanup.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    access.origin = address;
    const owner = new AdcClient(address, { cookie });
    const keys = generateNodeKeyPair();
    const pairing = await owner.createPairingCode();
    const paired = await new NodeApiClient(address, undefined, keys.privateKey).pair({
      code: pairing.code,
      label: "adapter-node",
      platform: "darwin",
      publicKey: keys.publicKey
    });
    const node = new NodeApiClient(address, paired.nodeId, keys.privateKey);
    await node.poll(
      CapabilitySchema.parse({
        schemaVersion: "0.1",
        nodeId: paired.nodeId,
        tools: [
          {
            name: "file.read",
            version: "0.1.0",
            risk: "read",
            sandboxProfiles: ["restricted-process"]
          }
        ],
        roots: [
          {
            rootId: "root_workspace",
            path: "/workspace",
            label: "Workspace",
            writable: false
          }
        ],
        platform: "darwin",
        nodeVersion: "0.1.0",
        advertisedAt: new Date().toISOString()
      })
    );
    const headers = {
      cookie,
      origin: address,
      "content-type": "application/json"
    };
    for (const [path, body] of [
      ["/api/v1/projects", { projectId: "proj_example", label: "Example" }],
      [
        "/api/v1/projects/proj_example/roots",
        {
          rootId: "root_workspace",
          nodeId: paired.nodeId,
          label: "Workspace",
          writable: false
        }
      ],
      [
        "/api/v1/grants",
        {
          grantId: "grant_example",
          projectId: "proj_example",
          actorId: "actor_testagent",
          profile: "read-only",
          nodeIds: [paired.nodeId],
          rootIds: ["root_workspace"],
          allowedTools: ["file.read"]
        }
      ]
    ] as const) {
      const response = await fetch(`${address}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(200);
    }

    const temporary = await mkdtemp(resolve(tmpdir(), "adc-cli-e2e-"));
    cleanup.push(() => rm(temporary, { recursive: true, force: true }));
    const cli = resolve(process.cwd(), "node_modules/.bin/tsx");
    const { stdout } = await execFileAsync(
      cli,
      [
        "apps/cli/src/main.ts",
        "invoke",
        "file.read",
        "--project",
        "proj_example",
        "--args",
        '{"path":"/workspace/README.md"}',
        "--json"
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ADC_CONFIG: resolve(temporary, "missing.json"),
          ADC_URL: address,
          ADC_TOKEN: agentToken,
          ADC_ACCOUNT_ID: "acct_primary",
          ADC_ACTOR_ID: "actor_testagent",
          ADC_GRANT_ID: "grant_example",
          ADC_PROJECT_ID: "proj_example",
          ADC_ROOT_IDS: "root_workspace"
        }
      }
    );
    const cliResult = JSON.parse(stdout.trim());
    expect(cliResult.status).toBe("queued");

    const mcp = new Client({ name: "adc-adapter-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${agentToken}` } }
    });
    await mcp.connect(transport as any);
    try {
      const tools = await mcp.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["file.read"]);
      expect(
        ((tools.tools[0]!.inputSchema.properties?.target as any).properties.nodeId as any).enum
      ).toEqual([paired.nodeId]);
      const called = await mcp.callTool({
        name: "file.read",
        arguments: {
          args: { path: "/workspace/README.md" },
          target: { nodeId: paired.nodeId }
        }
      });
      expect(called.isError).toBe(false);
      const mcpResult = JSON.parse(((called as any).content[0] as any).text);
      expect(mcpResult.status).toBe("queued");

      const cliDispatch = await store.getDispatchByInvocation(cliResult.invocationId);
      const mcpDispatch = await store.getDispatchByInvocation(mcpResult.invocationId);
      expect(cliDispatch?.invocation.args).toEqual(mcpDispatch?.invocation.args);
      expect(cliDispatch?.policyDecision).toEqual(mcpDispatch?.policyDecision);
      expect(cliDispatch?.nodeId).toBe(mcpDispatch?.nodeId);
      expect(cliDispatch?.invocation.metadata.source).toBe("cli");
      expect(mcpDispatch?.invocation.metadata.source).toBe("mcp");
    } finally {
      await mcp.close();
    }
  });
});
