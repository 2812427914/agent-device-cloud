import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { IdentityStore, PostgresStore } from "../packages/db/src/index.ts";
import { createAuthentication } from "../apps/control-plane/src/auth.ts";
import { createAccessService } from "../apps/control-plane/src/access.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import {
  buildInvocation,
  generateNodeKeyPair,
  signNodeRequest
} from "../packages/client/src/index.ts";
import { CapabilitySchema } from "../packages/protocol/src/index.ts";

const origin = "http://localhost:8787";
const password = "correct horse battery staple ADC";
function sessionCookie(response: LightMyRequestResponse) {
  const values = response.headers["set-cookie"];
  return (Array.isArray(values) ? values : values ? [values] : [])
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("persistent account identity and authorization", () => {
  let postgres: PostgresMemoryServer;
  let store: PostgresStore;
  let app: FastifyInstance;
  const secret = randomBytes(48).toString("base64url");
  const mails: Array<{ to: string; text: string }> = [];
  let signupClient = 1;
  const request = async (
    path: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) =>
    app.inject({
      method: body === undefined ? "GET" : "POST",
      url: path,
      headers: { origin, ...headers },
      ...(body === undefined ? {} : { payload: body })
    });
  async function signup(name: string) {
    const email = `${name}-${randomBytes(5).toString("hex")}@example.com`;
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      remoteAddress: `127.0.0.${++signupClient}`,
      headers: { origin },
      payload: { email, password, name }
    });
    expect(response.statusCode, response.body).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toContain("adc.session_token");
    const me = await request("/api/v1/me", undefined, { cookie });
    expect(me.statusCode, me.body).toBe(200);
    return { email, cookie, accountId: me.json().account.accountId as string };
  }
  beforeAll(async () => {
    postgres = await PostgresMemoryServer.create({
      database: "adc_identity",
      username: "adc_identity",
      password: "adc_identity"
    });
    store = new PostgresStore(postgres.getUri());
    const authentication = createAuthentication({
      pool: store.pool,
      baseURL: origin,
      secret,
      sendMail: async (mail) => {
        mails.push(mail);
      },
      allowDynamicClientRegistration: true
    });
    app = await createControlPlane({
      store,
      access: createAccessService(authentication, new IdentityStore(store.pool))
    });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it("requires login, rejects shared tokens, isolates accounts and prevents CSRF", async () => {
    expect((await request("/api/v1/nodes")).statusCode).toBe(401);
    expect(
      (
        await request("/api/v1/nodes", undefined, {
          authorization: "Bearer adc-local-review-token-2026"
        })
      ).statusCode
    ).toBe(401);
    const alice = await signup("alice");
    const bob = await signup("bob");
    expect(alice.accountId).not.toBe(bob.accountId);
    const created = await request(
      "/api/v1/projects",
      { label: "Private project" },
      { cookie: alice.cookie }
    );
    expect(created.statusCode, created.body).toBe(200);
    const project = created.json();
    expect(
      (await request("/api/v1/projects", undefined, { cookie: bob.cookie })).json().projects
    ).toEqual([]);
    expect(
      (
        await request(`/api/v1/projects/${project.projectId}/roots`, undefined, {
          cookie: bob.cookie
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await request(
          "/api/v1/projects",
          { projectId: project.projectId, label: "stolen" },
          { cookie: bob.cookie }
        )
      ).statusCode
    ).toBe(409);
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: alice.cookie, origin: "https://evil.example" },
      payload: { label: "CSRF" }
    });
    expect(forged.statusCode).toBe(403);
    const account = await store.pool.query(
      "SELECT owner_token_hash FROM adc_accounts WHERE account_id = $1",
      [alice.accountId]
    );
    expect(account.rows[0].owner_token_hash).toBeNull();
  });

  it("persists login across application restart and invalidates logout and password-reset sessions", async () => {
    const user = await signup("persistent");
    const wrong = await request("/api/auth/sign-in/email", {
      email: user.email,
      password: "incorrect password"
    });
    expect(wrong.statusCode).toBe(401);
    const login = await request("/api/auth/sign-in/email", { email: user.email, password });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = sessionCookie(login);
    await app.close();
    store = new PostgresStore(postgres.getUri());
    app = await createControlPlane({
      store,
      access: createAccessService(
        createAuthentication({
          pool: store.pool,
          baseURL: origin,
          secret,
          sendMail: async (mail) => {
            mails.push(mail);
          },
          allowDynamicClientRegistration: true
        }),
        new IdentityStore(store.pool)
      )
    });
    expect((await request("/api/v1/me", undefined, { cookie })).statusCode).toBe(200);
    const reset = await request("/api/auth/request-password-reset", {
      email: user.email,
      redirectTo: `${origin}/reset-password`
    });
    expect(reset.statusCode, reset.body).toBe(200);
    const mail = mails.findLast((entry) => entry.to === user.email)!;
    const link = mail.text.match(/http\S+/)?.[0];
    expect(link).toBeTruthy();
    const token = new URL(link!).pathname.split("/").at(-1)!;
    const changed = await request("/api/auth/reset-password", {
      token,
      newPassword: `${password} new`
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await request("/api/v1/me", undefined, { cookie })).statusCode).toBe(401);
    const signedIn = await request("/api/auth/sign-in/email", {
      email: user.email,
      password: `${password} new`
    });
    const activeCookie = sessionCookie(signedIn);
    expect((await request("/api/auth/sign-out", {}, { cookie: activeCookie })).statusCode).toBe(
      200
    );
    expect((await request("/api/v1/me", undefined, { cookie: activeCookie })).statusCode).toBe(401);
  }, 30_000);

  it("pairs to the code owner and prevents Agent credentials from administering or reading another grant", async () => {
    const alice = await signup("owner");
    const bob = await signup("outsider");
    const ownerHeaders = { cookie: alice.cookie };
    const pairCode = await request("/api/v1/pairing-codes", {}, ownerHeaders);
    const keys = generateNodeKeyPair();
    const pairing = await request("/api/v1/nodes/pair", {
      code: pairCode.json().code,
      label: "Laptop",
      platform: "linux",
      publicKey: keys.publicKey
    });
    expect(pairing.statusCode, pairing.body).toBe(200);
    const { nodeId, accountId } = pairing.json();
    expect(accountId).toBe(alice.accountId);
    expect(
      (await request(`/api/v1/nodes/${nodeId}/revoke`, {}, { cookie: bob.cookie })).statusCode
    ).toBe(404);
    const capability = CapabilitySchema.parse({
      schemaVersion: "0.1",
      nodeId,
      tools: [
        {
          name: "file.read",
          version: "0.1.0",
          risk: "read",
          sandboxProfiles: ["restricted-process"]
        }
      ],
      roots: [{ rootId: "root_identity", label: "Workspace", writable: false }],
      platform: "linux",
      nodeVersion: "0.1.0",
      advertisedAt: new Date().toISOString()
    });
    const poll = async () => {
      const path = `/api/v1/nodes/${nodeId}/poll`;
      const body = { capability };
      const timestamp = new Date().toISOString();
      const nonce = randomBytes(24).toString("base64url");
      const signature = signNodeRequest(keys.privateKey, {
        method: "POST",
        path,
        timestamp,
        nonce,
        body
      });
      return request(path, body, {
        "x-adc-node-id": nodeId,
        "x-adc-timestamp": timestamp,
        "x-adc-nonce": nonce,
        "x-adc-signature": signature
      });
    };
    expect((await poll()).statusCode).toBe(200);
    const project = (
      await request("/api/v1/projects", { label: "Workspace" }, ownerHeaders)
    ).json();
    expect(
      (
        await request(
          `/api/v1/projects/${project.projectId}/roots`,
          {
            nodeId,
            rootId: "root_identity",
            label: "Workspace",
            writable: false
          },
          ownerHeaders
        )
      ).statusCode
    ).toBe(200);
    const grantResponse = await request(
      "/api/v1/grants",
      {
        name: "Reader",
        projectId: project.projectId,
        profile: "read-only",
        nodeIds: [nodeId],
        rootIds: ["root_identity"],
        allowedTools: ["file.read", "task.status"]
      },
      ownerHeaders
    );
    expect(grantResponse.statusCode, grantResponse.body).toBe(200);
    const grant = grantResponse.json();
    const credentialResponse = await request(
      "/api/v1/credentials",
      { name: "Reader token", grantId: grant.grantId },
      ownerHeaders
    );
    expect(credentialResponse.statusCode, credentialResponse.body).toBe(200);
    const { token, credential } = credentialResponse.json();
    const agentHeaders = { authorization: `Bearer ${token}` };
    const me = await request("/api/v1/me", undefined, agentHeaders);
    expect(me.json().context.grantId).toBe(grant.grantId);
    for (const route of [
      "/api/v1/pairing-codes",
      "/api/v1/grants",
      "/api/v1/credentials",
      "/api/v1/approvals/apr_abc"
    ]) {
      expect((await request(route, {}, agentHeaders)).statusCode, route).toBe(403);
    }
    const invocation = buildInvocation({
      context: me.json().context,
      tool: "file.read",
      args: { rootId: "root_identity", path: "README.md" },
      target: { projectId: project.projectId },
      source: "sdk"
    });
    const queued = await request("/api/v1/invocations", invocation, agentHeaders);
    expect(queued.statusCode, queued.body).toBe(200);
    expect(queued.json().status).toBe("queued");
    const jobId = queued.json().jobId;
    expect(
      (await request(`/api/v1/tasks/${jobId}`, undefined, { cookie: bob.cookie })).statusCode
    ).toBe(404);
    expect(
      (await request(`/api/v1/tasks/${jobId}/cancel`, {}, { cookie: bob.cookie })).statusCode
    ).toBe(404);
    expect((await request(`/api/v1/tasks/${jobId}/cancel`, {}, agentHeaders)).statusCode).toBe(403);
    const forged = structuredClone(invocation);
    forged.accountId = bob.accountId;
    expect((await request("/api/v1/invocations", forged, agentHeaders)).statusCode).toBe(403);
    expect(
      (await request(`/api/v1/grants/${grant.grantId}/revoke`, {}, ownerHeaders)).statusCode
    ).toBe(200);
    expect((await request("/api/v1/me", undefined, agentHeaders)).statusCode).toBe(401);
    expect((await poll()).json().dispatch).toBeNull();
    const persisted = await store.pool.query(
      "SELECT token_hash FROM adc_credentials WHERE credential_id = $1",
      [credential.credentialId]
    );
    expect(persisted.rows[0].token_hash).not.toBe(token);
    expect(persisted.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);

  it("issues MCP OAuth tokens through PKCE and explicit consent, enforces audience and revocation", async () => {
    const user = await signup("oauth");
    const headers = { cookie: user.cookie };
    const resource = `${origin}/mcp`;
    const metadata = await request("/.well-known/oauth-authorization-server/api/auth");
    expect(metadata.statusCode, metadata.body).toBe(200);
    expect(metadata.json()).toMatchObject({
      issuer: `${origin}/api/auth`,
      code_challenge_methods_supported: ["S256"]
    });
    const registered = await request("/api/auth/oauth2/register", {
      client_name: "MCP integration test",
      redirect_uris: ["http://127.0.0.1:49321/callback"],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "adc:tools offline_access"
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const clientId = registered.json().client_id as string;
    const project = (
      await request("/api/v1/projects", { label: "OAuth workspace" }, headers)
    ).json();
    const grant = (
      await request(
        "/api/v1/grants",
        {
          name: "MCP reader",
          projectId: project.projectId,
          profile: "read-only",
          nodeIds: [],
          rootIds: [],
          allowedTools: ["device.list"]
        },
        headers
      )
    ).json();
    const verifier = randomBytes(48).toString("base64url");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: "http://127.0.0.1:49321/callback",
      scope: "adc:tools offline_access",
      resource,
      state: "test-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256"
    });
    const noPkce = new URLSearchParams(params);
    noPkce.delete("code_challenge");
    noPkce.delete("code_challenge_method");
    const rejected = await request(`/api/auth/oauth2/authorize?${noPkce}`, undefined, headers);
    expect(rejected.headers.location ?? rejected.body).toMatch(
      /invalid_request|PKCE|code_challenge/
    );
    const authorized = await request(`/api/auth/oauth2/authorize?${params}`, undefined, headers);
    expect(authorized.statusCode, authorized.body).toBe(302);
    const consentURL = new URL(authorized.headers.location!, origin);
    expect(consentURL.pathname).toBe("/authorize");
    const bound = await request(
      "/api/v1/oauth/bindings",
      { clientId, grantId: grant.grantId },
      headers
    );
    expect(bound.statusCode, bound.body).toBe(200);
    const consent = await request(
      "/api/auth/oauth2/consent",
      {
        accept: true,
        oauth_query: consentURL.search.slice(1)
      },
      headers
    );
    expect(consent.statusCode, consent.body).toBe(200);
    const callback = new URL(consent.json().url);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code!,
      redirect_uri: "http://127.0.0.1:49321/callback",
      code_verifier: verifier,
      resource
    }).toString();
    const exchange = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenBody
    });
    expect(exchange.statusCode, exchange.body).toBe(200);
    const tokens = exchange.json();
    expect(tokens.access_token).toMatch(/^adc_oat_/);
    expect(tokens.refresh_token).toBeTruthy();
    const me = await request("/api/v1/me", undefined, {
      authorization: `Bearer ${tokens.access_token}`
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().context.grantId).toBe(grant.grantId);
    expect(
      (
        await request(
          "/api/v1/pairing-codes",
          {},
          {
            authorization: `Bearer ${tokens.access_token}`
          }
        )
      ).statusCode
    ).toBe(403);
    const refresh = (body: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/api/auth/oauth2/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams(body).toString()
      });
    const wrongAudience = await refresh({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource: "https://other.example/mcp"
    });
    expect(wrongAudience.statusCode).toBe(400);
    const refreshed = await refresh({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(
      (
        await request("/api/v1/me", undefined, {
          authorization: `Bearer ${refreshed.json().access_token}`
        })
      ).statusCode
    ).toBe(200);
    // An unexchanged code must retain the old grant even if exchanged after reconnect.
    const pendingCode = await request(`/api/auth/oauth2/authorize?${params}`, undefined, headers);
    expect(pendingCode.statusCode, pendingCode.body).toBe(302);
    const staleCode = new URL(pendingCode.headers.location!, origin).searchParams.get("code");
    expect(staleCode).toBeTruthy();
    const revoked = await request("/api/v1/oauth/bindings/revoke", { clientId }, headers);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(
      (
        await request("/api/v1/me", undefined, {
          authorization: `Bearer ${refreshed.json().access_token}`
        })
      ).statusCode
    ).toBe(401);
    const staleRefresh = await refresh({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshed.json().refresh_token,
      resource
    });
    expect(staleRefresh.statusCode, staleRefresh.body).toBe(400);
    const reauthorize = await request(`/api/auth/oauth2/authorize?${params}`, undefined, headers);
    const newConsentURL = new URL(reauthorize.headers.location!, origin);
    expect(newConsentURL.pathname).toBe("/authorize");
    const rebound = await request(
      "/api/v1/oauth/bindings",
      { clientId, grantId: grant.grantId },
      headers
    );
    expect(rebound.statusCode, rebound.body).toBe(200);
    const newConsent = await request(
      "/api/auth/oauth2/consent",
      {
        accept: true,
        oauth_query: newConsentURL.search.slice(1)
      },
      headers
    );
    expect(newConsent.statusCode, newConsent.body).toBe(200);
    const newCode = new URL(newConsent.json().url).searchParams.get("code")!;
    const newExchange = await refresh({
      grant_type: "authorization_code",
      client_id: clientId,
      code: newCode,
      redirect_uri: "http://127.0.0.1:49321/callback",
      code_verifier: verifier,
      resource
    });
    expect(newExchange.statusCode, newExchange.body).toBe(200);
    expect(
      (
        await request("/api/v1/me", undefined, {
          authorization: `Bearer ${newExchange.json().access_token}`
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await request("/api/v1/me", undefined, {
          authorization: `Bearer ${refreshed.json().access_token}`
        })
      ).statusCode
    ).toBe(401);
    const staleExchange = await refresh({
      grant_type: "authorization_code",
      client_id: clientId,
      code: staleCode!,
      redirect_uri: "http://127.0.0.1:49321/callback",
      code_verifier: verifier,
      resource
    });
    if (staleExchange.statusCode === 200) {
      expect(
        (
          await request("/api/v1/me", undefined, {
            authorization: `Bearer ${staleExchange.json().access_token}`
          })
        ).statusCode
      ).toBe(401);
    } else expect(staleExchange.statusCode).toBe(400);
    const reused = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenBody
    });
    expect(reused.statusCode).toBe(400);
  }, 30_000);
});
