import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import { PostgresStore, IdentityStore } from "@adc/db";
import { createAuthentication, type Authentication } from "./auth.ts";
import { createAccessService } from "./access.ts";
import { createControlPlane } from "./app.ts";

const origin = "http://localhost:8787";
const secret = randomBytes(48).toString("base64url");
const credentials = { clientId: "github-test-client", clientSecret: "github-test-secret" };

describe("GitHub account authentication", () => {
  let postgres: PostgresMemoryServer;
  let store: PostgresStore;
  let authentication: Authentication;
  let app: Awaited<ReturnType<typeof createControlPlane>>;
  let client = 1;
  const makeAuth = (registrationEnabled = true) =>
    createAuthentication({
      pool: store.pool,
      baseURL: origin,
      secret,
      github: credentials,
      allowDynamicClientRegistration: true,
      registrationEnabled
    });
  const call = (auth: Authentication, path: string, body?: object, cookie = "") =>
    auth.handle(
      new Request(`${origin}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "x-adc-client-ip": `127.0.0.${++client}`
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
    );
  const cookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  function githubUser(id: number, email: string, verified = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url === "https://github.com/login/oauth/access_token")
          return Response.json({
            access_token: "test-provider-token",
            token_type: "bearer",
            scope: "read:user user:email"
          });
        if (url === "https://api.github.com/user")
          return Response.json({ id, login: `user-${id}`, name: "GitHub user", email: null });
        if (url === "https://api.github.com/user/emails")
          return Response.json([{ email, primary: true, verified }]);
        throw new Error(`Unexpected provider request: ${url}`);
      })
    );
  }
  async function signIn(auth = authentication, callbackURL = `${origin}/app`) {
    const start = await call(auth, "/sign-in/social", {
      provider: "github",
      callbackURL,
      errorCallbackURL: `${origin}/login`,
      disableRedirect: true
    });
    expect(start.status).toBe(200);
    const url = new URL((await start.json()).url);
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("client_id")).toBe(credentials.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/github`);
    expect(url.searchParams.get("scope")).toContain("user:email");
    expect(url.searchParams.has("client_secret")).toBe(false);
    const path = `/callback/github?code=test-code&state=${url.searchParams.get("state")}`;
    return {
      response: await call(auth, path, undefined, cookies(start)),
      path,
      cookie: cookies(start)
    };
  }
  beforeAll(async () => {
    postgres = await PostgresMemoryServer.create({
      database: "adc_github",
      username: "adc_github",
      password: "adc_github"
    });
    store = new PostgresStore(postgres.getUri());
    authentication = makeAuth();
    app = await createControlPlane({
      store,
      access: createAccessService(authentication, new IdentityStore(store.pool))
    });
  }, 60_000);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it("resumes the signed MCP authorization flow after GitHub login", async () => {
    const registered = await call(authentication, "/oauth2/register", {
      client_name: "GitHub to MCP",
      redirect_uris: ["http://127.0.0.1:49199/callback"],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "adc:tools offline_access"
    });
    expect(registered.status).toBe(201);
    const clientId = (await registered.json()).client_id;
    const verifier = randomBytes(48).toString("base64url");
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: "http://127.0.0.1:49199/callback",
      scope: "adc:tools offline_access",
      resource: `${origin}/mcp`,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "mcp-user-state"
    });
    const authorization = await call(authentication, `/oauth2/authorize?${query}`);
    const login = new URL(authorization.headers.get("location")!, origin);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.has("sig")).toBe(true);
    githubUser(100, "mcp-github@example.com");
    const signedIn = await signIn(authentication, login.href);
    expect(signedIn.response.headers.get("location")).toBe(login.href);
    const continued = await call(
      authentication,
      "/oauth2/continue",
      {
        oauth_query: login.search.slice(1),
        postLogin: true
      },
      cookies(signedIn.response)
    );
    expect(continued.status, await continued.clone().text()).toBe(200);
    const consent = new URL((await continued.json()).url, origin);
    expect(consent.pathname).toBe("/authorize");
    expect(consent.searchParams.get("client_id")).toBe(clientId);
    // Registration below asserts only its own users.
    await store.pool.query(`DELETE FROM adc_auth_users WHERE email = 'mcp-github@example.com'`);
  });

  it("creates one persistent account from a verified private email and rejects replay and unsafe redirects", async () => {
    githubUser(101, "verified@example.com");
    const { response, path, cookie } = await signIn();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${origin}/app`);
    const sessionCookie = cookies(response);
    expect(sessionCookie).toContain("adc.session_token");
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie: sessionCookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("verified@example.com");
    const replay = await call(authentication, path, undefined, cookie);
    expect(cookies(replay)).not.toContain("adc.session_token");
    const noState = await call(authentication, "/callback/github?code=forged");
    expect(cookies(noState)).not.toContain("adc.session_token");
    const unsafe = await call(authentication, "/sign-in/social", {
      provider: "github",
      callbackURL: "https://untrusted.example/app"
    });
    expect(unsafe.status).toBe(403);
    const config = await app.inject({ url: "/api/v1/auth/config" });
    expect(config.json().githubEnabled).toBe(true);
    expect(config.body).not.toContain(credentials.clientSecret);
  });

  it("rejects unverified email and prevents social login from bypassing disabled registration", async () => {
    githubUser(102, "unverified@example.com", false);
    const unverified = await signIn();
    expect(unverified.response.headers.get("location")).toContain("error=");
    expect(cookies(unverified.response)).not.toContain("adc.session_token");
    const closed = makeAuth(false);
    githubUser(103, "new@example.com");
    const denied = await signIn(closed);
    expect(denied.response.headers.get("location")).toContain("signup_disabled");
    expect(cookies(denied.response)).not.toContain("adc.session_token");
    githubUser(101, "verified@example.com");
    const existing = await signIn(closed);
    expect(cookies(existing.response)).toContain("adc.session_token");
    expect(existing.response.headers.get("location")).toBe(`${origin}/app`);
    const users = await store.pool.query("SELECT email FROM adc_auth_users");
    expect(users.rows).toEqual([{ email: "verified@example.com" }]);
  });

  it("does not implicitly link a GitHub identity into an unverified password account", async () => {
    const signup = await call(authentication, "/sign-up/email", {
      email: "local@example.com",
      name: "Local",
      password: "a long enough test password"
    });
    expect(signup.status).toBe(200);
    githubUser(104, "local@example.com");
    const linked = await signIn();
    expect(linked.response.headers.get("location")).toContain("error=");
    expect(cookies(linked.response)).not.toContain("adc.session_token");
    const accounts = await store.pool.query(
      `SELECT "providerId" FROM adc_auth_accounts WHERE "providerId" = 'github' AND "accountId" = '104'`
    );
    expect(accounts.rows).toEqual([]);
    // An authenticated owner may explicitly link the same verified GitHub email.
    const linking = await call(
      authentication,
      "/link-social",
      {
        provider: "github",
        callbackURL: `${origin}/app/settings`,
        disableRedirect: true
      },
      cookies(signup)
    );
    expect(linking.status).toBe(200);
    const linkUrl = new URL((await linking.json()).url);
    const linkedCallback = await call(
      authentication,
      `/callback/github?code=link-code&state=${linkUrl.searchParams.get("state")}`,
      undefined,
      `${cookies(signup)}; ${cookies(linking)}`
    );
    expect(linkedCallback.headers.get("location")).toBe(`${origin}/app/settings`);
    const relogin = await signIn(makeAuth(false));
    expect(cookies(relogin.response)).toContain("adc.session_token");
    const localMe = await app.inject({
      url: "/api/v1/me",
      headers: { cookie: cookies(relogin.response) }
    });
    expect(localMe.json().user.email).toBe("local@example.com");
    const disabled = createAuthentication({ pool: store.pool, baseURL: origin, secret });
    expect(disabled.githubEnabled).toBe(false);
    expect(
      (
        await call(disabled, "/sign-in/social", {
          provider: "github",
          callbackURL: `${origin}/app`
        })
      ).status
    ).toBe(404);
    expect(() =>
      createAuthentication({
        pool: store.pool,
        baseURL: origin,
        secret,
        github: { clientId: "partial", clientSecret: "" }
      })
    ).toThrow("requires both");
  });
});
