import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PostgresStore, IdentityStore, MemoryStore } from "../packages/db/src/index.ts";
import {
  AdcClient,
  NodeApiClient,
  buildInvocation,
  generateNodeKeyPair
} from "../packages/client/src/index.ts";
import { CapabilitySchema, ReceiptSchema } from "../packages/protocol/src/index.ts";
import { sha256 } from "../packages/policy/src/index.ts";
import { createAuthentication } from "../apps/control-plane/src/auth.ts";
import { createAccessService } from "../apps/control-plane/src/access.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

const origin = "http://localhost:8787";
describe("account resource management through HTTP and MCP", () => {
  let postgres: PostgresMemoryServer, store: PostgresStore;
  let app: Awaited<ReturnType<typeof createControlPlane>>, address: string;
  let cookie = "",
    outsider = "";
  const request = (
    url: string,
    payload?: object,
    method: "POST" | "PATCH" | "DELETE" = "POST",
    authCookie = cookie
  ) =>
    app.inject({
      method: payload === undefined ? "GET" : method,
      url,
      headers: { origin, cookie: authCookie },
      ...(payload === undefined ? {} : { payload })
    });
  beforeAll(async () => {
    postgres = await PostgresMemoryServer.create({
      database: "adc_management",
      username: "adc_management",
      password: "adc_management"
    });
    store = new PostgresStore(postgres.getUri());
    app = await createControlPlane({
      store,
      access: createAccessService(
        createAuthentication({
          pool: store.pool,
          baseURL: origin,
          secret: randomBytes(48).toString("hex")
        }),
        new IdentityStore(store.pool)
      )
    });
    address = await app.listen({ host: "127.0.0.1", port: 0 });
    const signup = async (name: string) => {
      const response = await request("/api/auth/sign-up/email", {
        name,
        email: `${name}@example.com`,
        password: "a long resource management password"
      });
      expect(response.statusCode, response.body).toBe(200);
      const header = response.headers["set-cookie"]!;
      return (Array.isArray(header) ? header : [header])
        .map((value) => value.split(";")[0])
        .join("; ");
    };
    cookie = await signup("owner");
    outsider = await signup("outsider");
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });
  async function pair(label: string) {
    const code = (await request("/api/v1/pairing-codes", {})).json().code;
    const keys = generateNodeKeyPair();
    const paired = await new NodeApiClient(address, undefined, keys.privateKey).pair({
      code,
      label,
      platform: "darwin",
      publicKey: keys.publicKey
    });
    const client = new NodeApiClient(address, paired.nodeId, keys.privateKey);
    const capability = CapabilitySchema.parse({
      schemaVersion: "0.1",
      nodeId: paired.nodeId,
      platform: "darwin",
      accessMode: "selected",
      nodeVersion: "0.1.0",
      advertisedAt: new Date().toISOString(),
      roots: [
        { rootId: "root_workspace", path: "/workspace", label: "Workspace", writable: true },
        { rootId: "root_docs", path: "/docs", label: "Docs", writable: false }
      ],
      tools: ["file.read", "file.write", "shell.exec"].map((name) => ({
        name,
        version: "0.1.0",
        risk: name === "file.read" ? "read" : "write",
        sandboxProfiles: ["restricted-process"]
      }))
    });
    await client.poll(capability);
    return { ...paired, keys, client, capability };
  }
  const grantBody = (nodeId: string) => ({
    name: "Coding agent",
    profile: "workspace-write",
    nodeIds: [nodeId],
    rootAccess: "all",
    rootIds: [],
    approvalPolicy: "never",
    allowedTools: ["device.list", "file.read", "file.write", "shell.exec", "task.status"]
  });
  async function grant(nodeId: string) {
    const created = await request("/api/v1/grants", grantBody(nodeId));
    expect(created.statusCode, created.body).toBe(200);
    const credential = await request("/api/v1/credentials", {
      name: "Existing token",
      grantId: created.json().grantId
    });
    expect(credential.statusCode, credential.body).toBe(200);
    return { grant: created.json(), token: credential.json().token as string };
  }
  const me = async (token: string) => {
    const response = await app.inject({
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  it("edits device scope without losing pairing, rejects stale/foreign changes and applies limits to existing work", async () => {
    const node = await pair("Work Mac");
    const duplicate = await pair("Reserved name");
    const authorization = await grant(node.nodeId);
    const agent = new AdcClient(address, authorization.token);
    const current = await me(authorization.token);
    const queued = await agent.invoke(
      buildInvocation({
        context: current.context,
        source: "sdk",
        tool: "file.write",
        args: { rootId: "root_workspace", path: "note.txt", content: "hello" },
        idempotencyKey: "management-device-write"
      })
    );
    expect(queued.status).toBe("queued");
    const { dispatch } = await node.client.poll(node.capability);
    expect(dispatch).toBeTruthy();
    await node.client.acknowledge(dispatch!.dispatchId, dispatch!.leaseToken!);
    const changes = {
      revision: 1,
      label: "Renamed Mac",
      accessPolicy: {
        rootAccess: "selected",
        rootIds: ["root_workspace"],
        readOnlyRootIds: ["root_workspace"],
        allowExecution: false
      }
    };
    expect(
      (await request(`/api/v1/nodes/${node.nodeId}`, changes, "PATCH", outsider)).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/nodes/${node.nodeId}`,
          headers: { origin: "https://evil.example", cookie },
          payload: changes
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/nodes/${node.nodeId}`,
          headers: { authorization: `Bearer ${authorization.token}` },
          payload: changes
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await request(
          `/api/v1/nodes/${node.nodeId}`,
          { ...changes, label: "Reserved name" },
          "PATCH"
        )
      ).statusCode
    ).toBe(409);
    const changed = await request(`/api/v1/nodes/${node.nodeId}`, changes, "PATCH");
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({
      revision: 2,
      label: changes.label,
      publicKey: node.keys.publicKey
    });
    expect((await request(`/api/v1/nodes/${node.nodeId}`, changes, "PATCH")).statusCode).toBe(409);
    const updated = await me(authorization.token);
    expect(updated.context.rootIds).toEqual(["root_workspace"]);
    expect(updated.context.resourcesByNode).toEqual({
      [node.nodeId]: [{ rootId: "root_workspace", path: "/workspace" }]
    });
    expect(
      (await node.client.renewLease(dispatch!.dispatchId, dispatch!.leaseToken!)).cancelRequested
    ).toBe(true);
    expect(
      (
        await agent.invoke(
          buildInvocation({
            context: updated.context,
            source: "sdk",
            tool: "file.write",
            args: { rootId: "root_workspace", path: "new.txt", content: "blocked" },
            idempotencyKey: "management-blocked-write"
          })
        )
      ).status
    ).toBe("denied");
    expect(
      (
        await agent.invoke(
          buildInvocation({
            context: updated.context,
            source: "sdk",
            tool: "shell.exec",
            args: { rootId: "root_workspace", cwd: "", command: "pwd" },
            idempotencyKey: "management-blocked-command"
          })
        )
      ).status
    ).toBe("denied");
    const mcp = new Client({ name: "management-test", version: "1.0.0" });
    try {
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${authorization.token}` } }
        }) as any
      );
      const result = await mcp.callTool({ name: "device.list", arguments: { args: {} } });
      const visible = JSON.parse((result.content as any)[0].text).output.nodes[0];
      expect(visible.label).toBe("Renamed Mac");
      expect(visible.capability.roots).toEqual([
        {
          rootId: "root_workspace",
          path: "/workspace",
          label: "Workspace",
          writable: false
        }
      ]);
      expect(visible.capability.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        "shell.exec"
      );
    } finally {
      await mcp.close();
    }
    // Device presence does not overwrite owner controls.
    await node.client.poll(node.capability);
    expect((await store.getNode(node.nodeId))?.accessPolicy).toEqual(changes.accessPolicy);
    expect(
      (
        await request(
          `/api/v1/nodes/${node.nodeId}`,
          {
            ...changes,
            revision: 2,
            accessPolicy: { ...changes.accessPolicy, rootIds: ["root_not_exposed"] }
          },
          "PATCH"
        )
      ).statusCode
    ).toBe(400);
    expect(
      (await request(`/api/v1/nodes/${duplicate.nodeId}`, { revision: 1 }, "DELETE")).statusCode
    ).toBe(200);
  });

  it("updates authorization in place with the same token and invalidates deleted grants while preserving history", async () => {
    const node = await pair("Grant Mac");
    const { grant: original, token } = await grant(node.nodeId);
    const actorId = original.actorId;
    const agent = new AdcClient(address, token);
    const owner = (await request("/api/v1/me")).json();
    expect(
      (
        await request("/api/v1/oauth/bindings", {
          clientId: "management-client",
          grantId: original.grantId
        })
      ).statusCode
    ).toBe(200);
    const generation = (
      await store.pool.query(
        "SELECT generation FROM adc_oauth_bindings WHERE client_id = 'management-client'"
      )
    ).rows[0].generation;
    const body = {
      ...grantBody(node.nodeId),
      name: "Updated agent",
      rootAccess: "selected",
      rootIds: ["root_docs"],
      allowedTools: ["device.list", "file.read", "task.status"],
      approvalPolicy: "always",
      revision: 1
    };
    expect(
      (await request(`/api/v1/grants/${original.grantId}`, body, "PATCH", outsider)).statusCode
    ).toBe(404);
    expect(
      (
        await request("/api/v1/grants", {
          ...grantBody(node.nodeId),
          grantId: original.grantId,
          actorId
        })
      ).statusCode
    ).toBe(409);
    const changed = await request(`/api/v1/grants/${original.grantId}`, body, "PATCH");
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({
      grantId: original.grantId,
      actorId,
      revision: 2,
      createdAt: original.createdAt
    });
    expect((await request(`/api/v1/grants/${original.grantId}`, body, "PATCH")).statusCode).toBe(
      409
    );
    const updated = await me(token);
    expect(updated.grant.name).toBe("Updated agent");
    expect(updated.context.rootIds).toEqual(["root_docs"]);
    expect(
      await new IdentityStore(store.pool).oauthBinding(
        owner.user.id,
        "management-client",
        generation
      )
    ).toEqual({ accountId: original.accountId, grantId: original.grantId });
    expect(
      (
        await agent.invoke(
          buildInvocation({
            context: updated.context,
            source: "sdk",
            tool: "file.write",
            args: { rootId: "root_docs", path: "blocked.txt", content: "blocked" },
            idempotencyKey: "grant-no-write-after-edit"
          })
        )
      ).status
    ).toBe("denied");
    const result = await agent.invoke(
      buildInvocation({
        context: updated.context,
        source: "sdk",
        tool: "file.read",
        args: { rootId: "root_docs", path: "README.md" }
      })
    );
    expect(result.status).toBe("approval_required");
    expect(
      (await request(`/api/v1/grants/${original.grantId}`, { revision: 2 }, "DELETE", outsider))
        .statusCode
    ).toBe(404);
    const removed = await request(`/api/v1/grants/${original.grantId}`, { revision: 2 }, "DELETE");
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } }))
        .statusCode
    ).toBe(401);
    expect(
      (await request("/api/v1/grants"))
        .json()
        .grants.some((item: { grantId: string }) => item.grantId === original.grantId)
    ).toBe(false);
    expect(
      (await request("/api/v1/credentials"))
        .json()
        .credentials.some((item: { grantId: string }) => item.grantId === original.grantId)
    ).toBe(false);
    expect(
      (await request("/api/v1/oauth/bindings"))
        .json()
        .bindings.some((item: { grantId: string }) => item.grantId === original.grantId)
    ).toBe(false);
    expect(
      await new IdentityStore(store.pool).oauthBinding(
        owner.user.id,
        "management-client",
        generation
      )
    ).toBeUndefined();
    expect(
      (await store.listApprovals(original.accountId)).find(
        (item) => item.invocation.invocationId === result.invocationId
      )?.status
    ).toBe("denied");
    expect((await store.getGrant(original.grantId))?.deletedAt).toBeTruthy();
    expect(
      (await store.listAudit(original.accountId))
        .filter((item) => item.payload.grantId === original.grantId)
        .map((item) => item.type)
    ).toContain("grant.deleted");
    expect(
      (await request(`/api/v1/grants/${original.grantId}`, { ...body, revision: 3 }, "PATCH"))
        .statusCode
    ).toBe(404);
  });

  it("removes active and revoked devices, cancels queued tasks and frees the name without erasing receipts", async () => {
    const node = await pair("Retired Mac");
    const { token } = await grant(node.nodeId);
    const agent = new AdcClient(address, token);
    const context = (await me(token)).context;
    const completedInput = buildInvocation({
      context,
      source: "sdk",
      tool: "file.read",
      args: { rootId: "root_workspace", path: "finished.txt" }
    });
    await agent.invoke(completedInput);
    const completedDispatch = (await node.client.poll(node.capability)).dispatch!;
    await node.client.acknowledge(completedDispatch.dispatchId, completedDispatch.leaseToken!);
    const receipt = ReceiptSchema.parse({
      schemaVersion: "0.1",
      receiptId: "rcpt_management",
      invocationId: completedInput.invocationId,
      attemptId: completedInput.attemptId,
      nodeId: node.nodeId,
      tool: "file.read",
      terminalStatus: "succeeded",
      sideEffect: false,
      argsHash: sha256(completedInput.args),
      policyDecisionHash: completedDispatch.policyDecision.decisionHash,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0
    });
    await node.client.complete({
      dispatchId: completedDispatch.dispatchId,
      leaseToken: completedDispatch.leaseToken!,
      result: {
        schemaVersion: "0.1",
        invocationId: completedInput.invocationId,
        attemptId: completedInput.attemptId,
        status: "succeeded",
        output: { content: "history retained" },
        receipt
      }
    });
    const queued = await agent.invoke(
      buildInvocation({
        context,
        source: "sdk",
        tool: "file.read",
        args: { rootId: "root_workspace", path: "README.md" }
      })
    );
    const response = await request(`/api/v1/nodes/${node.nodeId}`, { revision: 1 }, "DELETE");
    expect(response.statusCode, response.body).toBe(200);
    expect((await store.getDispatchByInvocation(queued.invocationId))?.status).toBe("cancelled");
    expect((await request(`/api/v1/tasks/${queued.jobId}`)).json().status).toBe("cancelled");
    expect(
      (await store.listNodes(node.accountId)).some((item) => item.nodeId === node.nodeId)
    ).toBe(false);
    expect((await store.getNode(node.nodeId))?.publicKey).toBe(node.keys.publicKey);
    expect((await store.getDispatchByInvocation(completedInput.invocationId))?.receipt).toEqual(
      receipt
    );
    await expect(node.client.poll(node.capability)).rejects.toThrow();
    const replacement = await pair("Retired Mac");
    expect(replacement.nodeId).not.toBe(node.nodeId);
    expect((await request(`/api/v1/nodes/${replacement.nodeId}/revoke`, {})).statusCode).toBe(200);
    const sameNameAfterRevoke = await pair("Retired Mac");
    expect(sameNameAfterRevoke.nodeId).not.toBe(replacement.nodeId);
    expect(
      (await request(`/api/v1/nodes/${replacement.nodeId}`, { revision: 2 }, "DELETE")).statusCode
    ).toBe(200);

    const pendingKeys = generateNodeKeyPair();
    const pending = await new NodeApiClient(address, undefined, pendingKeys.privateKey).pair({
      code: (await request("/api/v1/pairing-codes", {})).json().code,
      label: "Interrupted setup",
      platform: "darwin",
      publicKey: pendingKeys.publicKey
    });
    const retryKeys = generateNodeKeyPair();
    const retry = await new NodeApiClient(address, undefined, retryKeys.privateKey).pair({
      code: (await request("/api/v1/pairing-codes", {})).json().code,
      label: "Interrupted setup",
      platform: "darwin",
      publicKey: retryKeys.publicKey
    });
    expect(retry.nodeId).not.toBe(pending.nodeId);
    expect((await store.getNode(pending.nodeId))?.deletedAt).toBeTruthy();
  });
});

it("keeps memory-store management behavior consistent with persistent storage", async () => {
  const store = new MemoryStore();
  const cookie = "adc.session_token=management";
  const app = await createControlPlane({ store, access: accessFixture({ cookie }) });
  const headers = { cookie, origin: "http://adc.test" };
  try {
    const code = (
      await app.inject({ method: "POST", url: "/api/v1/pairing-codes", headers, payload: {} })
    ).json().code;
    const paired = (
      await app.inject({
        method: "POST",
        url: "/api/v1/nodes/pair",
        payload: {
          code,
          label: "Memory Mac",
          platform: "darwin",
          publicKey: generateNodeKeyPair().publicKey
        }
      })
    ).json();
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/nodes/${paired.nodeId}`,
      headers,
      payload: {
        revision: 1,
        label: "Memory renamed",
        accessPolicy: { rootAccess: "all", rootIds: [], readOnlyRootIds: [], allowExecution: true }
      }
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().revision).toBe(2);
    const granted = (
      await app.inject({
        method: "POST",
        url: "/api/v1/grants",
        headers,
        payload: {
          name: "Memory agent",
          nodeIds: [paired.nodeId],
          allowedTools: ["device.list"],
          rootAccess: "all"
        }
      })
    ).json();
    const payload = {
      name: "Memory edited",
      profile: "workspace-write",
      nodeIds: [paired.nodeId],
      allowedTools: ["device.list"],
      rootAccess: "selected",
      rootIds: [],
      approvalPolicy: "never",
      revision: 1
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/grants/${granted.grantId}`,
          headers,
          payload
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/grants/${granted.grantId}`,
          headers,
          payload: { revision: 2 }
        })
      ).statusCode
    ).toBe(200);
    expect(await store.listGrants("acct_primary")).toEqual([]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/nodes/${paired.nodeId}`,
          headers,
          payload: { revision: 2 }
        })
      ).statusCode
    ).toBe(200);
    expect(await store.listNodes("acct_primary")).toEqual([]);
  } finally {
    await app.close();
  }
});
