import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import {
  AdcClient,
  NodeApiClient,
  buildInvocation,
  generateNodeKeyPair
} from "../packages/client/src/index.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { CapabilitySchema } from "../packages/protocol/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

describe("direct device grants", () => {
  it("shares current local scope across CLI, Skill and MCP without project bindings", async () => {
    const store = new MemoryStore();
    const cookie = "adc.session_token=device-access";
    const access = accessFixture({
      cookie,
      agents: {
        "device-access-token": { accountId: "acct_primary", grantId: "grant_device" },
        "selected-access-token": { accountId: "acct_primary", grantId: "grant_selected" }
      }
    });
    const app = await createControlPlane({ store, access });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    access.origin = address;
    const mcp = new Client({ name: "device-first-test", version: "0.1.0" });
    try {
      const owner = new AdcClient(address, { cookie });
      const keys = generateNodeKeyPair();
      const paired = await new NodeApiClient(address, undefined, keys.privateKey).pair({
        code: (await owner.createPairingCode()).code,
        label: "My device",
        platform: "darwin",
        publicKey: keys.publicKey
      });
      const node = new NodeApiClient(address, paired.nodeId, keys.privateKey);
      const capability = (rootIds: string[]) =>
        CapabilitySchema.parse({
          schemaVersion: "0.1",
          nodeId: paired.nodeId,
          platform: "darwin",
          accessMode: "selected",
          nodeVersion: "0.1.0",
          advertisedAt: new Date().toISOString(),
          roots: rootIds.map((rootId) => ({ rootId, label: rootId, writable: true })),
          tools: ["file.read", "file.write"].map((name) => ({
            name,
            version: "0.1.0",
            risk: name === "file.read" ? "read" : "write",
            sandboxProfiles: ["restricted-process"]
          }))
        });
      await node.poll(capability(["root_first"]));
      const grant = async (payload: Record<string, unknown>) =>
        app.inject({
          method: "POST",
          url: "/api/v1/grants",
          headers: { cookie, origin: address },
          payload
        });
      const common = {
        nodeIds: [paired.nodeId],
        approvalPolicy: "writes",
        allowedTools: ["device.list", "file.read", "file.write"]
      };
      expect(
        (
          await grant({
            ...common,
            grantId: "grant_device",
            rootAccess: "all"
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await grant({
            ...common,
            grantId: "grant_selected",
            rootIds: ["root_first"]
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await grant({
            ...common,
            rootAccess: "all",
            nodeIds: ["node_foreign"]
          })
        ).statusCode
      ).toBe(403);
      expect(await store.listProjects("acct_primary")).toEqual([]);

      const agent = new AdcClient(address, "device-access-token");
      const selected = new AdcClient(address, "selected-access-token");
      const first = await agent.me();
      expect(first.kind).toBe("agent");
      if (first.kind !== "agent") throw new Error("agent expected");
      expect(first.context).toMatchObject({ rootIds: ["root_first"], rootAccess: "all" });
      expect(first.context.projectId).toBeUndefined();

      await node.poll(capability(["root_first", "root_second"]));
      const current = await agent.me();
      if (current.kind !== "agent") throw new Error("agent expected");
      expect(current.context.rootIds).toEqual(["root_first", "root_second"]);
      const args = { rootId: "root_second", path: "README.md" };
      const input = buildInvocation({
        context: first.context,
        tool: "file.read",
        args,
        source: "sdk"
      });
      expect((await agent.invoke(input)).status).toBe("queued");
      const limited = await selected.me();
      if (limited.kind !== "agent") throw new Error("agent expected");
      expect(
        (
          await selected.invoke(
            buildInvocation({
              context: { ...limited.context, rootIds: ["root_second"] },
              tool: "file.read",
              args,
              source: "sdk"
            })
          )
        ).status
      ).toBe("denied");
      expect(
        (
          await agent.invoke(
            buildInvocation({
              context: current.context,
              tool: "file.write",
              args: { ...args, content: "review" },
              source: "sdk",
              idempotencyKey: "device-access-write"
            })
          )
        ).status
      ).toBe("approval_required");

      for (const source of ["cli", "skill"]) {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            "apps/cli/src/main.ts",
            "invoke",
            "file.read",
            "--args",
            JSON.stringify(args),
            "--source",
            source,
            "--json"
          ],
          { env: { ...process.env, ADC_URL: address, ADC_TOKEN: "device-access-token" } }
        );
        const result = JSON.parse(stdout);
        expect(result.status).toBe("queued");
        expect(
          (await store.getDispatchByInvocation(result.invocationId))?.invocation.metadata.source
        ).toBe(source);
      }
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
          requestInit: { headers: { authorization: "Bearer device-access-token" } }
        }) as any
      );
      const called = await mcp.callTool({
        name: "file.read",
        arguments: { args, target: { nodeId: paired.nodeId } }
      });
      expect(called.isError).toBe(false);
      const discovery = await mcp.callTool({ name: "device.list", arguments: { args: {} } });
      expect(
        JSON.parse((discovery.content as any)[0].text).output.nodes[0].capability.roots
      ).toHaveLength(2);

      await node.poll(capability(["root_first"]));
      expect(
        (
          await agent.invoke(
            buildInvocation({
              context: current.context,
              tool: "file.read",
              args,
              source: "sdk"
            })
          )
        ).status
      ).toBe("denied");
      await store.revokeGrant("acct_primary", "grant_device", new Date());
      expect(
        (
          await agent.invoke(
            buildInvocation({
              context: current.context,
              tool: "file.read",
              args: { rootId: "root_first", path: "README.md" },
              source: "sdk"
            })
          )
        ).status
      ).toBe("denied");
    } finally {
      await mcp.close();
      await app.close();
    }
  });
});
