import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AdcClient } from "@adc/client";

const AgentConfigSchema = z
  .object({
    url: z.string().url(),
    token: z.string().min(1)
  })
  .strict();
const SessionConfigSchema = z.union([
  z.object({ url: z.string().url(), cookie: z.string().min(1) }).strict(),
  z.object({ url: z.string().url(), token: z.string().min(1) }).strict()
]);
type AgentConfig = z.infer<typeof AgentConfigSchema>;
type SessionConfig = z.infer<typeof SessionConfigSchema>;
const configPath = process.env.ADC_CONFIG ?? resolve(homedir(), ".config", "adc", "config.json");
// Management sessions are never loaded by invoke/MCP or included in an agent config.
const sessionPath = `${configPath}.session`;
const DeviceAuthorizationSchema = z
  .object({
    device_code: z.string().min(1),
    user_code: z.string().min(1),
    verification_uri: z.string().url(),
    verification_uri_complete: z.string().url(),
    expires_in: z.number().int().positive(),
    interval: z.number().int().positive()
  })
  .strict();
const DeviceTokenSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string(),
    expires_in: z.number().int().positive(),
    scope: z.string()
  })
  .passthrough();

export function serverURL(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Use the installation's origin, without a path, credentials or query.");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("Use HTTPS for a remote installation.");
  return url.origin;
}

async function save(path: string, config: AgentConfig | SessionConfig) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .filter((value) => /^(?:__Secure-)?adc\.session_token=.+/.test(value))
    .join("; ");
}

export async function loadAgent(): Promise<AgentConfig> {
  if (process.env.ADC_TOKEN) {
    if (!process.env.ADC_URL) throw new Error("ADC_URL is required with ADC_TOKEN.");
    return { url: serverURL(process.env.ADC_URL), token: process.env.ADC_TOKEN };
  }
  const disk = await readFile(configPath, "utf8").catch(() => {
    throw new Error("Agent connection is unavailable. Sign in and run adc connect ACCESS.");
  });
  const config = AgentConfigSchema.safeParse(JSON.parse(disk));
  if (!config.success)
    throw new Error("Agent connection is invalid. Sign in and run adc connect ACCESS.");
  return { ...config.data, url: serverURL(config.data.url) };
}

export async function loadSession(): Promise<SessionConfig> {
  const content = await readFile(sessionPath, "utf8").catch(() => {
    throw new Error("Sign in first: adc login --url URL");
  });
  const config = SessionConfigSchema.parse(JSON.parse(content));
  return { ...config, url: serverURL(config.url) };
}

export async function readSecret(label: string, fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += String(chunk);
      if (value.length > 8192) throw new Error("Input is too long.");
    }
    return value.replace(/\r?\n$/, "");
  }
  if (!process.stdin.isTTY)
    throw new Error(
      "Interactive input requires a terminal. Use --stdin for a token or --password-stdin for a password."
    );
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write(`${label}: `);
  try {
    return await prompt.question("");
  } finally {
    prompt.close();
    muted.end();
    process.stderr.write("\n");
  }
}

export async function signIn(url: string, email: string, password: string) {
  const response = await fetch(`${url}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "error",
    headers: { origin: url, "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = (await response.json()) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Sign-in failed (HTTP ${response.status}).`);
  const cookie = sessionCookie(response);
  if (!cookie)
    throw new Error("Sign-in did not return a session. Verify your email and try again.");
  const config = { url, cookie };
  const me = await new AdcClient(url, { cookie }).me();
  if (me.kind !== "session") throw new Error("Expected a user session.");
  await save(sessionPath, config);
  return { loggedIn: true, user: me.user, url };
}

function openBrowser(url: string): void {
  const executable =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : process.platform === "win32"
          ? "cmd"
          : undefined;
  if (!executable) return;
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.once("error", () => {});
  child.unref();
}

export async function signInWithBrowser(url: string, noOpen = false) {
  const started = await fetch(`${url}/api/auth/device/code`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "adc-cli", scope: "adc:manage" })
  });
  const startBody = await started.json().catch(() => ({}));
  if (!started.ok) {
    const error = startBody as { error_description?: string; message?: string };
    throw new Error(
      error.error_description ?? error.message ?? `Browser login failed (HTTP ${started.status}).`
    );
  }
  const authorization = DeviceAuthorizationSchema.parse(startBody);
  process.stderr.write(
    `Open this URL to sign in:\n${authorization.verification_uri_complete}\n` +
      `Code: ${authorization.user_code}\nWaiting for approval...\n`
  );
  if (!noOpen) openBrowser(authorization.verification_uri_complete);

  const deadline = Date.now() + authorization.expires_in * 1000;
  let intervalMs = authorization.interval * 1000;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, intervalMs));
    const response = await fetch(`${url}/api/auth/device/token`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: authorization.device_code,
        client_id: "adc-cli"
      })
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    if (response.ok) {
      const token = DeviceTokenSchema.parse(body).access_token;
      const config = { url, token };
      const me = await new AdcClient(url, { sessionToken: token }).me();
      if (me.kind !== "session") throw new Error("Expected an account login.");
      await save(sessionPath, config);
      return { loggedIn: true, user: me.user, url };
    }
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    if (body.error === "access_denied") throw new Error("Browser login was denied.");
    if (body.error === "expired_token")
      throw new Error("Browser login expired. Run adc login again.");
    throw new Error(body.error_description ?? `Browser login failed (HTTP ${response.status}).`);
  }
  throw new Error("Browser login expired. Run adc login again.");
}

export async function importToken(url: string, token: string) {
  const me = await new AdcClient(url, token).me();
  if (me.kind !== "agent") throw new Error("Only scoped Agent access keys can be imported.");
  await save(configPath, { url, token });
  return { connected: true, access: me.grant.name, context: me.context, url };
}

export async function authStatus() {
  const inspect = async (kind: "agent" | "session") => {
    try {
      const config = kind === "agent" ? await loadAgent() : await loadSession();
      const me = await new AdcClient(
        config.url,
        kind === "agent"
          ? (config as AgentConfig).token
          : "cookie" in config
            ? { cookie: config.cookie }
            : { sessionToken: config.token }
      ).me();
      return me.kind === "session"
        ? { authenticated: true, url: config.url, user: me.user }
        : {
            authenticated: true,
            url: config.url,
            access: { id: me.context.grantId, name: me.grant.name }
          };
    } catch (error) {
      return { authenticated: false, message: (error as Error).message };
    }
  };
  return { login: await inspect("session"), connection: await inspect("agent") };
}

export async function signOut() {
  let sessionRevoked = false;
  const content = await readFile(sessionPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (content) {
    const session = SessionConfigSchema.parse(JSON.parse(content));
    const url = serverURL(session.url);
    const response = await fetch(`${url}/api/auth/sign-out`, {
      method: "POST",
      redirect: "error",
      headers: {
        origin: url,
        ...("cookie" in session
          ? { cookie: session.cookie }
          : { authorization: `Bearer ${session.token}` }),
        "content-type": "application/json"
      },
      body: "{}"
    });
    if (!response.ok && response.status !== 401)
      throw new Error("Could not revoke the session. Retry when the server is reachable.");
    sessionRevoked = true;
  }
  await rm(sessionPath, { force: true });
  await rm(configPath, { force: true });
  return {
    signedOut: true,
    sessionRevoked,
    message: "Local login and connection removed. Revoke other connections from your account."
  };
}
