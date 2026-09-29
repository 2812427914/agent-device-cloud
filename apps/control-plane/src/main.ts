import { IdentityStore, PostgresStore } from "@adc/db";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { createControlPlane } from "./app.ts";
import { createAuthentication } from "./auth.ts";
import { createAccessService } from "./access.ts";

const databaseURL = process.env.DATABASE_URL;
const secret = process.env.ADC_AUTH_SECRET;
const publicURL = process.env.ADC_PUBLIC_URL;
if (!databaseURL)
  throw new Error(
    "DATABASE_URL is required. PostgreSQL stores accounts, sessions and device state."
  );
if (!secret)
  throw new Error("ADC_AUTH_SECRET is required. Generate it with: openssl rand -base64 48");
if (!publicURL)
  throw new Error(
    "ADC_PUBLIC_URL is required, for example http://localhost:8787 or https://devices.example.com"
  );
const origin = new URL(publicURL);
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
  throw new Error("ADC_PUBLIC_URL must be an origin without a path, credentials or query.");
}
if (
  origin.protocol !== "https:" &&
  !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
) {
  throw new Error("Public installations require an HTTPS ADC_PUBLIC_URL.");
}
const consoleDirectory =
  process.env.ADC_CONSOLE_DIR ?? fileURLToPath(new URL("../../console/dist", import.meta.url));
if (!existsSync(`${consoleDirectory}/index.html`)) {
  throw new Error("Console build is missing. Run pnpm build before starting the server.");
}
const analyticsScriptUrl = process.env.ADC_ANALYTICS_SCRIPT_URL;
const analyticsDomain = process.env.ADC_ANALYTICS_DOMAIN;
if (!!analyticsScriptUrl !== !!analyticsDomain) {
  throw new Error("ADC_ANALYTICS_SCRIPT_URL and ADC_ANALYTICS_DOMAIN must be configured together.");
}
if (analyticsScriptUrl) {
  const analyticsUrl = new URL(analyticsScriptUrl);
  if (analyticsUrl.protocol !== "https:") {
    throw new Error("ADC_ANALYTICS_SCRIPT_URL must use HTTPS.");
  }
}
if (analyticsDomain && !/^[a-z0-9.-]{1,253}$/i.test(analyticsDomain)) {
  throw new Error("ADC_ANALYTICS_DOMAIN must be a hostname.");
}
const store = new PostgresStore(databaseURL);
const mailer = process.env.ADC_SMTP_URL
  ? nodemailer.createTransport(process.env.ADC_SMTP_URL)
  : undefined;
const authentication = createAuthentication({
  pool: store.pool,
  baseURL: publicURL,
  secret,
  registrationEnabled: process.env.ADC_REGISTRATION_ENABLED !== "false",
  requireEmailVerification: process.env.ADC_REQUIRE_EMAIL_VERIFICATION === "true",
  allowDynamicClientRegistration: process.env.ADC_OAUTH_DYNAMIC_REGISTRATION === "true",
  ...(process.env.ADC_GITHUB_CLIENT_ID || process.env.ADC_GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.ADC_GITHUB_CLIENT_ID ?? "",
          clientSecret: process.env.ADC_GITHUB_CLIENT_SECRET ?? ""
        }
      }
    : {}),
  ...(mailer
    ? {
        sendMail: async (mail) => {
          await mailer.sendMail({
            ...mail,
            from: process.env.ADC_SMTP_FROM ?? "Agent Device Cloud <no-reply@localhost>"
          });
        }
      }
    : {})
});
const app = await createControlPlane({
  store,
  access: createAccessService(authentication, new IdentityStore(store.pool)),
  logger: true,
  consoleDirectory,
  ...(analyticsScriptUrl && analyticsDomain
    ? {
        analytics: {
          provider: "plausible" as const,
          scriptUrl: analyticsScriptUrl,
          domain: analyticsDomain
        }
      }
    : {}),
  nodeDistribution: {
    directory:
      process.env.ADC_NODE_RELEASE_DIR ??
      fileURLToPath(new URL("../../../dist/node", import.meta.url)),
    publicUrl: publicURL,
    ...(process.env.ADC_NODE_DOWNLOAD_URL ? { downloadUrl: process.env.ADC_NODE_DOWNLOAD_URL } : {})
  },
  ...(process.env.ADC_TRUSTED_PROXIES
    ? { trustProxy: process.env.ADC_TRUSTED_PROXIES.split(",") }
    : {})
});
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void app
      .close()
      .then(() => {
        mailer?.close();
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        app.log.error(error);
        process.exitCode = 1;
      });
  });
}
