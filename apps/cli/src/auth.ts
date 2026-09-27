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
const SessionConfigSchema = z
  .object({
    url: z.string().url(),
    cookie: z.string().min(1)
  })
  .strict();
type AgentConfig = z.infer<typeof AgentConfigSchema>;
type SessionConfig = z.infer<typeof SessionConfigSchema>;
const configPath = process.env.ADC_CONFIG ?? resolve(homedir(), ".config", "adc", "config.json");
// Management sessions are never loaded by invoke/MCP or included in an agent config.
const sessionPath = `${configPath}.session`;

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

export async function loadAgent(): Promise<AgentConfig> {
  if (process.env.ADC_TOKEN) {
    if (!process.env.ADC_URL) throw new Error("ADC_URL is required with ADC_TOKEN.");
    return { url: serverURL(process.env.ADC_URL), token: process.env.ADC_TOKEN };
  }
  const disk = await readFile(configPath, "utf8").catch(() => {
    throw new Error("Create an agent token in the console, then run adc auth token --url URL.");
  });
  const config = AgentConfigSchema.safeParse(JSON.parse(disk));
  if (!config.success)
    throw new Error("Legacy CLI configuration is unsupported. Run adc auth token --url URL again.");
  return { ...config.data, url: serverURL(config.data.url) };
}

export async function loadSession(): Promise<SessionConfig> {
  const content = await readFile(sessionPath, "utf8").catch(() => {
    throw new Error("Sign in first: adc auth login --url URL --email EMAIL");
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
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .filter((value) => /^(?:__Secure-)?adc\.session_token=.+/.test(value))
    .join("; ");
  if (!cookie)
    throw new Error("Sign-in did not return a session. Verify your email and try again.");
  const config = { url, cookie };
  const me = await new AdcClient(url, { cookie }).me();
  if (me.kind !== "session") throw new Error("Expected a user session.");
  await save(sessionPath, config);
  return { authenticated: true, kind: me.kind, user: me.user, url };
}

export async function importToken(url: string, token: string) {
  const me = await new AdcClient(url, token).me();
  if (me.kind !== "agent") throw new Error("Only scoped agent tokens can be imported.");
  await save(configPath, { url, token });
  return { authenticated: true, kind: "agent", name: me.grant.name, context: me.context, url };
}

export async function authStatus() {
  const inspect = async (kind: "agent" | "session") => {
    try {
      const config = kind === "agent" ? await loadAgent() : await loadSession();
      const me = await new AdcClient(
        config.url,
        "token" in config ? config.token : { cookie: config.cookie }
      ).me();
      return { authenticated: true, url: config.url, ...me };
    } catch (error) {
      return { kind, authenticated: false, message: (error as Error).message };
    }
  };
  return { session: await inspect("session"), agent: await inspect("agent") };
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
      headers: { origin: url, cookie: session.cookie, "content-type": "application/json" },
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
    message:
      "Local credentials removed. Revoke agent tokens in the console to disconnect other copies."
  };
}
