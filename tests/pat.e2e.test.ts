import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { IdentityStore, PostgresStore } from "../packages/db/src/index.ts";
import { createAuthentication } from "../apps/control-plane/src/auth.ts";
import { createAccessService } from "../apps/control-plane/src/access.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";

const origin = "http://localhost:8787";
const password = "correct horse battery staple ADC";

function sessionCookie(response: LightMyRequestResponse) {
  const values = response.headers["set-cookie"];
  return (Array.isArray(values) ? values : values ? [values] : [])
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("owner personal access tokens", () => {
  let postgres: PostgresMemoryServer;
  let app: FastifyInstance;
  const secret = randomBytes(48).toString("base64url");
  let signupClient = 0;

  const get = (path: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: path, headers: { origin, ...headers } });
  const post = (
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) => app.inject({ method: "POST", url: path, headers: { origin, ...headers }, payload: body });

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
    return sessionCookie(response);
  }

  beforeAll(async () => {
    postgres = await PostgresMemoryServer.create({
      database: "adc_pats",
      username: "adc_pats",
      password: "adc_pats"
    });
    const store = new PostgresStore(postgres.getUri());
    const authentication = createAuthentication({
      pool: store.pool,
      baseURL: origin,
      secret,
      sendMail: async () => {},
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

  it("creates, authenticates, scopes and revokes owner PATs", async () => {
    const cookie = await signup("pat-owner");

    // An agent-style shared token must not reach owner routes.
    expect(
      (await get("/api/v1/nodes", { authorization: "Bearer adc_shared_token" })).statusCode
    ).toBe(401);

    const created = await post("/api/v1/pats", { label: "Zion panel", readOnly: true }, { cookie });
    expect(created.statusCode, created.body).toBe(200);
    const { pat, token } = created.json() as { pat: { patId: string }; token: string };
    expect(token).toMatch(/^adc_pat_[A-Za-z0-9_-]{43}$/);

    const listed = await get("/api/v1/pats", { cookie });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().pats[0]).toMatchObject({ patId: pat.patId, readOnly: true });

    // The token authenticates and identifies itself via /me.
    const me = await get("/api/v1/me", { authorization: `Bearer ${token}` });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ kind: "pat", patId: pat.patId, readOnly: true });

    // Owner reads work with the PAT.
    expect((await get("/api/v1/nodes", { authorization: `Bearer ${token}` })).statusCode).toBe(200);

    // Read-only PATs cannot write owner state.
    expect(
      (await post("/api/v1/projects", { label: "blocked" }, { authorization: `Bearer ${token}` }))
        .statusCode
    ).toBe(403);

    // Read-only PATs cannot mint or revoke tokens either.
    expect(
      (await post("/api/v1/pats", { label: "self-mint" }, { authorization: `Bearer ${token}` }))
        .statusCode
    ).toBe(403);
    expect(
      (
        await post(`/api/v1/pats/${pat.patId}/revoke`, {}, { authorization: `Bearer ${token}` })
      ).statusCode
    ).toBe(403);

    // A full PAT can write owner state cross-origin (no CSRF surface without cookies).
    const full = await post("/api/v1/pats", { label: "automation" }, { cookie });
    expect(full.statusCode, full.body).toBe(200);
    const fullToken = (full.json() as { token: string }).token;
    const project = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { origin: "https://plugin.example", authorization: `Bearer ${fullToken}` },
      payload: { label: "Headless" }
    });
    expect(project.statusCode, project.body).toBe(200);

    // But token management stays session-only even for full PATs.
    expect(
      (await post("/api/v1/pats", { label: "mint via pat" }, { authorization: `Bearer ${fullToken}` }))
        .statusCode
    ).toBe(403);

    // Revocation takes effect immediately.
    const revoked = await post(`/api/v1/pats/${pat.patId}/revoke`, {}, { cookie });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await get("/api/v1/me", { authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it("scopes PAT data to the owning account", async () => {
    const firstCookie = await signup("first");
    const secondCookie = await signup("second");
    const created = await post("/api/v1/pats", { label: "first token" }, { cookie: firstCookie });
    const token = (created.json() as { token: string }).token;
    const nodes = await get("/api/v1/nodes", { authorization: `Bearer ${token}` });
    expect(nodes.statusCode).toBe(200);
    expect(nodes.json().nodes).toEqual([]);
    // The other account's session sees no tokens from the first account.
    const listed = (await get("/api/v1/pats", { cookie: secondCookie })).json();
    expect(listed.pats).toEqual([]);
  });
});
