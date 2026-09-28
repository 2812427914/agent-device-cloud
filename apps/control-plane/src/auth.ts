import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { github } from "better-auth/social-providers";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { getMigrations } from "better-auth/db/migration";
import {
  getOAuthProviderApi,
  oauthProvider,
  oauthProviderAuthServerMetadata,
  type ActiveAccessTokenPayload,
  type AuthServerMetadata,
  type OAuthOptions,
  type Scope
} from "@better-auth/oauth-provider";
import type { Pool } from "pg";
import { z } from "zod";

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}

export interface AuthenticationOptions {
  pool: Pool;
  baseURL: string;
  secret: string;
  registrationEnabled?: boolean;
  requireEmailVerification?: boolean;
  sendMail?: (mail: AuthMail) => Promise<void>;
  allowDynamicClientRegistration?: boolean;
  github?: { clientId: string; clientSecret: string };
}

/** Authentication is identical for managed and self-hosted installations. */
export function createAuthentication(options: AuthenticationOptions) {
  const origin = new URL(options.baseURL).origin;
  const oauthClient = new AsyncLocalStorage<string>();
  if (options.secret.length < 32)
    throw new Error("ADC_AUTH_SECRET must be at least 32 characters.");
  if (options.requireEmailVerification && !options.sendMail) {
    throw new Error("Email verification requires an SMTP transport.");
  }
  if (options.github && (!options.github.clientId.trim() || !options.github.clientSecret.trim())) {
    throw new Error(
      "GitHub login requires both ADC_GITHUB_CLIENT_ID and ADC_GITHUB_CLIENT_SECRET."
    );
  }
  const githubProvider = options.github ? github(options.github) : undefined;
  const providerOptions: OAuthOptions<Scope[]> = {
    loginPage: "/login",
    consentPage: "/authorize",
    scopes: ["adc:tools", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    resources: [{ identifier: `${origin}/mcp`, allowedScopes: ["adc:tools", "offline_access"] }],
    clientRegistrationDefaultResources: [`${origin}/mcp`],
    clientRegistrationDefaultScopes: ["adc:tools", "offline_access"],
    allowDynamicClientRegistration: options.allowDynamicClientRegistration ?? false,
    allowUnauthenticatedClientRegistration: options.allowDynamicClientRegistration ?? false,
    allowPublicClientPrelogin: true,
    clientRegistrationRequirePKCE: true,
    accessTokenExpiresIn: 15 * 60,
    refreshTokenExpiresIn: 30 * 24 * 3600,
    disableJwtPlugin: true,
    storeTokens: "hashed",
    resourcePrivileges: async () => false,
    // Consent references are immutable token-family authorization versions.
    // The provider carries referenceId from code -> access/refresh -> introspection.
    postLogin: {
      page: "/authorize",
      shouldRedirect: async () => false,
      consentReferenceId: async ({ user }) => {
        const clientId = oauthClient.getStore();
        if (!clientId) throw new APIError("BAD_REQUEST", { message: "OAuth client is required." });
        const result = await options.pool.query<{ generation: string }>(
          `SELECT b.generation FROM adc_oauth_bindings b
           JOIN adc_agent_grants g ON g.grant_id = b.grant_id AND g.account_id = b.account_id
           WHERE b.user_id = $1 AND b.client_id = $2 AND b.revoked_at IS NULL AND g.revoked_at IS NULL`,
          [user.id, clientId]
        );
        return result.rows[0]?.generation;
      }
    },
    customAccessTokenClaims: async ({ referenceId }) => ({ adc_binding: referenceId ?? null }),
    prefix: { opaqueAccessToken: "adc_oat_", refreshToken: "adc_ort_" }
  };
  const auth = betterAuth({
    appName: "Agent Device Cloud",
    baseURL: origin,
    basePath: "/api/auth",
    secret: options.secret,
    database: options.pool,
    trustedOrigins: [origin],
    socialProviders: options.github
      ? {
          github: {
            ...options.github,
            disableSignUp: options.registrationEnabled === false,
            // Keep the library's token exchange and email lookup. Even when local
            // email verification is optional, GitHub must prove email ownership.
            getUserInfo: async (tokens) => {
              const info = await githubProvider!.getUserInfo(tokens);
              return info?.user.email && info.user.emailVerified ? info : null;
            }
          }
        }
      : {},
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      disableSignUp: options.registrationEnabled === false,
      requireEmailVerification: options.requireEmailVerification ?? false,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendMail
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              await options.sendMail!({
                to: user.email,
                subject: "Reset your Agent Device Cloud password",
                text: `Reset your password using this link:\n${url}\n\nIgnore this email if you did not request it.`
              });
            }
          }
        : {})
    },
    emailVerification: {
      sendOnSignUp: options.requireEmailVerification ?? false,
      autoSignInAfterVerification: true,
      ...(options.sendMail
        ? {
            sendVerificationEmail: async ({
              user,
              url
            }: {
              user: { email: string };
              url: string;
            }) => {
              await options.sendMail!({
                to: user.email,
                subject: "Verify your Agent Device Cloud email",
                text: `Verify your email address:\n${url}`
              });
            }
          }
        : {})
    },
    user: { modelName: "adc_auth_users" },
    account: {
      modelName: "adc_auth_accounts",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false
      }
    },
    session: {
      modelName: "adc_auth_sessions",
      expiresIn: 7 * 24 * 3600,
      updateAge: 24 * 3600,
      freshAge: 15 * 60,
      cookieCache: { enabled: false }
    },
    verification: { modelName: "adc_auth_verifications" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "adc_auth_rate_limits",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 }
      }
    },
    advanced: {
      // Startup runs the migration validator under a PostgreSQL advisory lock
      // before accepting HTTP traffic; disable the library's racing background check.
      database: { validateSchema: false },
      cookiePrefix: "adc",
      useSecureCookies: origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // The HTTP adapter supplies a server-derived address, never an arbitrary client header.
      ipAddress: { ipAddressHeaders: ["x-adc-client-ip"] }
    },
    disabledPaths: ["/token"],
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: "10m",
        interval: "2s",
        verificationUri: `${origin}/cli-login`,
        validateClient: (clientId) => clientId === "adc-cli",
        onDeviceAuthRequest: (_clientId, scope) => {
          if (scope !== "adc:manage")
            throw new APIError("BAD_REQUEST", { message: "Invalid CLI authorization scope." });
        },
        schema: { deviceCode: { modelName: "adc_auth_device_codes" } }
      }),
      // Provider OpenAPI declarations explicitly include undefined on optional fields.
      // Intersect only the plugin contract to bridge upstream exactOptionalPropertyTypes.
      compatiblePlugin(oauthProvider(providerOptions)),
      {
        id: "adc-resource-verification",
        endpoints: {
          verifyAdcAccessToken: createAuthEndpoint.serverOnly(
            { method: "POST", body: z.object({ token: z.string().min(1) }) },
            async (ctx) =>
              getOAuthProviderApi(
                ctx as unknown as Parameters<typeof getOAuthProviderApi>[0],
                providerOptions
              ).requireActiveAccessToken(ctx.body.token)
          )
        }
      }
    ]
  });
  // The provider's endpoint metadata conflicts with exactOptionalPropertyTypes.
  // Keep this compatibility assertion at the library boundary; HTTP input still
  // passes the provider's runtime validation and the endpoint remains server-only.
  const providerApi = auth.api as unknown as {
    getOAuthServerConfig: (input: { headers: Headers }) => Promise<AuthServerMetadata>;
    verifyAdcAccessToken: (input: { body: { token: string } }) => Promise<ActiveAccessTokenPayload>;
  };
  return {
    auth,
    origin,
    issuer: `${origin}/api/auth`,
    resource: `${origin}/mcp`,
    registrationEnabled: options.registrationEnabled !== false,
    passwordResetEnabled: !!options.sendMail,
    githubEnabled: !!options.github,
    requireEmailVerification: options.requireEmailVerification ?? false,
    metadata: oauthProviderAuthServerMetadata({ api: providerApi }),
    verifyAccessToken: (token: string) => providerApi.verifyAdcAccessToken({ body: { token } }),
    async handle(request: Request) {
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        [
          "/api/auth/sign-in/social",
          "/api/auth/link-social",
          "/api/auth/device/approve",
          "/api/auth/device/deny"
        ].includes(url.pathname)
      ) {
        if (request.headers.get("origin") !== origin)
          return Response.json({ message: "A same-origin request is required." }, { status: 403 });
        const body = await request
          .clone()
          .json()
          .catch(() => null);
        if (body && typeof body === "object") {
          for (const field of ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]) {
            if (body[field] === undefined) continue;
            try {
              const target = new URL(body[field], origin);
              if (
                typeof body[field] !== "string" ||
                target.origin !== origin ||
                target.username ||
                target.password
              )
                throw new Error("Invalid callback");
            } catch {
              return Response.json(
                { message: "A same-origin callback is required." },
                { status: 403 }
              );
            }
          }
        }
      }
      let clientId = url.searchParams.get("client_id");
      if (request.method === "POST" && url.pathname.startsWith("/api/auth/oauth2/")) {
        const text = await request.clone().text();
        if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
          clientId = new URLSearchParams(text).get("client_id");
        } else {
          try {
            const body = JSON.parse(text) as { client_id?: string; oauth_query?: string };
            clientId =
              typeof body.oauth_query === "string"
                ? new URLSearchParams(body.oauth_query).get("client_id")
                : typeof body.client_id === "string"
                  ? body.client_id
                  : null;
          } catch {
            /* The provider returns the normal malformed-request response. */
          }
        }
      }
      return oauthClient.run(clientId ?? "", () => auth.handler(request));
    },
    async revokeOAuthTokens(userId: string, clientId: string) {
      const { adapter } = await auth.$context;
      const where = [
        { field: "userId", value: userId },
        { field: "clientId", value: clientId }
      ];
      await adapter.updateMany({
        model: "oauthRefreshToken",
        where,
        update: { revoked: new Date() }
      });
      await adapter.updateMany({
        model: "oauthAccessToken",
        where,
        update: { revoked: new Date() }
      });
      await adapter.deleteMany({ model: "oauthConsent", where });
    },
    async migrate() {
      const lock = await options.pool.connect();
      try {
        await lock.query("SELECT pg_advisory_lock(728194033)");
        const migrations = await getMigrations(auth.options);
        await migrations.runMigrations();
      } finally {
        await lock.query("SELECT pg_advisory_unlock(728194033)");
        lock.release();
      }
    }
  };
}

export type Authentication = ReturnType<typeof createAuthentication>;

function compatiblePlugin<T>(plugin: T): T & BetterAuthPlugin {
  return plugin as T & BetterAuthPlugin;
}
