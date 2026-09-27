#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AdcClient, AdcClientError, buildInvocation } from "@adc/client";
import { createMcpServer } from "@adc/mcp-adapter";
import { ToolIdSchema, isSideEffectTool, type InvocationResult } from "@adc/protocol";
import {
  authStatus,
  importToken,
  loadAgent,
  loadSession,
  readSecret,
  serverURL,
  signIn,
  signOut
} from "./auth.ts";

function parseArgs(args: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const item = args[index]!;
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      index++;
    }
  }
  return { positionals, flags };
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requiredFlag(flags: Map<string, string | true>, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function jsonArgument(value: string): Promise<unknown> {
  const content = value.startsWith("@") ? await readFile(resolve(value.slice(1)), "utf8") : value;
  return JSON.parse(content);
}

function exitCode(result: InvocationResult): number {
  if (["queued", "running", "succeeded"].includes(result.status)) return 0;
  if (result.status === "denied") return 20;
  if (result.status === "approval_required") return 21;
  if (result.status === "offline") return 22;
  if (result.status === "unknown_outcome") return 23;
  if (result.status === "cancelled") return 24;
  return 1;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (value && typeof value === "object" && "status" in value) {
    const result = value as InvocationResult;
    console.log(`${result.status}${result.jobId ? ` ${result.jobId}` : ""}`);
    if (result.output !== undefined) console.log(JSON.stringify(result.output, null, 2));
    if (result.error) console.error(`${result.error.code}: ${result.error.message}`);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [domain, action] = positionals;
  const json = flags.has("json");

  if (flags.has("version") || domain === "version") {
    console.log(process.env.ADC_BUILD_VERSION ?? "0.1.0-dev");
    return;
  }
  if (!domain || flags.has("help") || domain === "help") {
    console.log(
      "Usage: adc auth login|token|status|logout | node list|pairing-code | invoke TOOL --args JSON | task status|result|cancel JOB | artifact get ID | audit show|list | mcp\nDevice setup and background service: adc-node --help"
    );
    return;
  }

  if (domain === "auth" && action === "login") {
    const url = serverURL(requiredFlag(flags, "url"));
    const email = requiredFlag(flags, "email");
    const password = await readSecret("Password", flags.has("password-stdin"));
    print(await signIn(url, email, password), json);
    return;
  }
  if (domain === "auth" && action === "token") {
    const url = serverURL(requiredFlag(flags, "url"));
    const token = await readSecret("Agent token", flags.has("stdin"));
    print(await importToken(url, token), json);
    return;
  }
  if (domain === "auth" && action === "status") {
    print(await authStatus(), json);
    return;
  }
  if (domain === "auth" && action === "logout") {
    print(await signOut(), json);
    return;
  }

  const management = (domain === "node" && action === "pairing-code") || flags.has("session");
  if (management && !["node", "audit"].includes(domain ?? "")) {
    throw new Error(
      "Session credentials are only for device management and audit. Invoke and MCP require an agent token."
    );
  }
  const config = management ? await loadSession() : await loadAgent();
  const client = new AdcClient(
    config.url,
    "token" in config ? config.token : { cookie: config.cookie }
  );

  if (domain === "node" && action === "list") {
    if (management) {
      print({ schemaVersion: "0.1", nodes: await client.listNodes() }, json);
      return;
    }
    const me = await client.me();
    if (me.kind !== "agent") throw new Error("An agent token is required.");
    const result = await client.invoke(
      buildInvocation({
        context: me.context,
        tool: "device.list",
        args: {},
        source: "cli"
      })
    );
    print(
      result.status === "succeeded"
        ? { schemaVersion: "0.1", nodes: (result.output as { nodes: unknown[] }).nodes }
        : result,
      json
    );
    process.exitCode = exitCode(result);
    return;
  }
  if (domain === "node" && action === "pairing-code") {
    print(await client.createPairingCode(Number(stringFlag(flags, "ttl") ?? 600)), json);
    return;
  }
  if (domain === "invoke") {
    if (!action) throw new Error("tool name is required");
    const tool = ToolIdSchema.parse(action);
    const me = await client.me();
    if (me.kind !== "agent") throw new Error("Invocations require an agent token.");
    const projectId = stringFlag(flags, "project") ?? me.context.projectId;
    if (projectId !== me.context.projectId)
      throw new Error("The project must match this token's authorization.");
    const rootIds = (stringFlag(flags, "roots")?.split(",") ?? me.context.rootIds).filter(Boolean);
    if (me.context.rootAccess !== "all" && rootIds.some((id) => !me.context.rootIds.includes(id)))
      throw new Error("Requested folders are outside this token's authorization.");
    if (flags.has("actor") || flags.has("grant") || flags.has("account"))
      throw new Error("Account and agent identity are derived from the credential.");
    const nodeId = stringFlag(flags, "node");
    const idempotencyKey = stringFlag(flags, "idempotency-key");
    if (isSideEffectTool(tool) && !idempotencyKey) {
      throw new Error("--idempotency-key is required for side-effecting tools");
    }
    const toolArgs = await jsonArgument(requiredFlag(flags, "args"));
    const invocation = buildInvocation({
      context: {
        ...me.context,
        rootIds,
        ...(flags.has("roots") ? { rootAccess: "selected" as const } : {}),
        ...(projectId ? { projectId } : {})
      },
      tool,
      args: toolArgs,
      ...(nodeId
        ? { target: { nodeId } }
        : projectId && stringFlag(flags, "affinity")
          ? {
              target: {
                projectId: projectId!,
                affinity: stringFlag(flags, "affinity")!
              }
            }
          : {}),
      source: stringFlag(flags, "source") === "skill" ? "skill" : "cli",
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(stringFlag(flags, "timeout") ? { timeoutMs: Number(stringFlag(flags, "timeout")) } : {})
    });
    const result = await client.invoke(invocation);
    print(result, json);
    process.exitCode = exitCode(result);
    return;
  }
  if (domain === "task" && (action === "status" || action === "result" || action === "cancel")) {
    const jobId = positionals[2];
    if (!jobId) throw new Error("job id is required");
    const result =
      action === "cancel" ? await client.cancelTask(jobId) : await client.taskStatus(jobId);
    print(result, json);
    process.exitCode = exitCode(result);
    return;
  }
  if (domain === "artifact" && action === "get") {
    const artifactId = positionals[2];
    if (!artifactId) throw new Error("artifact id is required");
    const data = await client.artifact(artifactId);
    const output = stringFlag(flags, "output");
    if (output) {
      await writeFile(resolve(output), data, { flag: "w", mode: 0o600 });
      print({ schemaVersion: "0.1", artifactId, bytes: data.byteLength, output }, json);
    } else if (json) {
      print(
        {
          schemaVersion: "0.1",
          artifactId,
          bytes: data.byteLength,
          dataBase64: Buffer.from(data).toString("base64")
        },
        true
      );
    } else {
      process.stdout.write(data);
    }
    return;
  }
  if (domain === "audit" && (action === "show" || action === "list")) {
    print(
      {
        schemaVersion: "0.1",
        events: await client.audit(action === "show" ? positionals[2] : undefined)
      },
      json
    );
    return;
  }
  if (domain === "mcp") {
    const me = await client.me();
    if (me.kind !== "agent") throw new Error("MCP requires an agent token.");
    const server = createMcpServer({
      client,
      context: me.context,
      loadContext: async () => {
        const current = await client.me();
        if (current.kind !== "agent") throw new Error("Agent authorization is unavailable.");
        return current.context;
      },
      allowedTools: me.grant.allowedTools
    });
    await server.connect(new StdioServerTransport());
    return;
  }

  throw new Error(
    "Usage: adc auth login|token|status|logout | node list|pairing-code | invoke TOOL | task status|result|cancel JOB | artifact get ID | audit show|list | mcp"
  );
}

main().catch((error) => {
  if (error instanceof AdcClientError) {
    process.stderr.write(`${JSON.stringify({ error: error.error })}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
