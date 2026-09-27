import { existsSync, openSync } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ReadStream, WriteStream } from "node:tty";
import { NodeApiClient, generateNodeKeyPair } from "@adc/client";
import { NodeDaemon } from "./daemon.ts";
import {
  ConfigSchema,
  AccessModeSchema,
  ControlPlaneUrlSchema,
  McpProviderConfigSchema,
  accessRoots,
  configPath,
  localFolder,
  loadConfig,
  saveConfig
} from "./config.ts";
import {
  installService,
  serviceStatus,
  showLogs,
  startService,
  stopService,
  uninstall
} from "./service.ts";

const version = process.env.ADC_BUILD_VERSION ?? "0.1.0-dev";
const usage = `Agent Device Cloud device ${version}
Usage:
  adc-node setup --url ORIGIN --code CODE [--label NAME] [--root-path FOLDER]
                 [--access none|selected|home|full] [--root-id ID] [--read-only] [--no-service]
  adc-node access [none|selected|home|full] [--read-only]
  adc-node roots list
  adc-node roots add FOLDER [--root-id ID] [--label NAME] [--read-only]
  adc-node roots remove ROOT_ID
  adc-node mcp list
  adc-node mcp add PROVIDER_ID --stdio COMMAND [--name NAME] [--args JSON] [--env-file PATH] [--cwd PATH]
  adc-node mcp add PROVIDER_ID --http URL [--name NAME] [--headers-file PATH]
  adc-node mcp remove PROVIDER_ID
  adc-node status | start | stop | restart | logs
  adc-node run               Run in the foreground
  adc-node rotate-key        Rotate this device's identity key
  adc-node unpair --confirm NODE_ID
                              Remove local identity, preserve durable receipts
  adc-node uninstall         Remove program/service, preserve identity and receipts
  adc-node --version
Repeat the installation command to upgrade. Existing identity and folders are preserved.
Folder changes reload automatically. Full trust runs with your OS user's permissions.
`;

function argumentsMap(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const flags = new Set(["no-service", "read-only"]);
  const names = new Set([
    "url",
    "code",
    "label",
    "root-id",
    "root-path",
    "writable",
    "access",
    "confirm",
    "name",
    "stdio",
    "args",
    "env-file",
    "cwd",
    "http",
    "headers-file"
  ]);
  for (let index = 0; index < args.length; index++) {
    const key = args[index]?.replace(/^--/, "");
    if (!args[index]?.startsWith("--") || !key || (!names.has(key) && !flags.has(key))) {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
    if (values.has(key)) throw new Error(`Duplicate argument: --${key}`);
    if (flags.has(key)) {
      values.set(key, "true");
      continue;
    }
    const value = args[++index];
    if (!value) throw new Error(`--${key} requires a value`);
    values.set(key, value);
  }
  return values;
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function jsonOption<T>(values: Map<string, string>, name: string, fallback: T): T {
  const value = values.get(name);
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`--${name} must be valid JSON.`);
  }
}

async function jsonFileOption<T>(
  values: Map<string, string>,
  name: string,
  fallback: T
): Promise<T> {
  const path = values.get(name);
  if (path === undefined) return fallback;
  try {
    const canonical = resolve(path);
    const metadata = await stat(canonical);
    if (!metadata.isFile() || metadata.size > 1024 * 1024 || (metadata.mode & 0o077) !== 0) {
      throw new Error("unsafe file");
    }
    return JSON.parse(await readFile(canonical, "utf8")) as T;
  } catch {
    throw new Error(`--${name} must reference a mode-0600 JSON file smaller than 1 MiB.`);
  }
}

async function prompt(label: string, fallback: string): Promise<string> {
  let input: ReadStream;
  let output: WriteStream;
  try {
    input = new ReadStream(openSync("/dev/tty", "r"));
    output = new WriteStream(openSync("/dev/tty", "w"));
  } catch {
    return fallback;
  }
  const terminal = createInterface({ input, output, terminal: true });
  try {
    return (await terminal.question(`${label} [${fallback}]: `)).trim() || fallback;
  } finally {
    terminal.close();
    input.destroy();
    output.destroy();
  }
}

async function pair(args: Map<string, string>, interactive: boolean): Promise<void> {
  const controlPlaneUrl = ControlPlaneUrlSchema.parse(required(args, "url"));
  const code = required(args, "code");
  const label =
    args.get("label") ?? (interactive ? await prompt("Device name", hostname()) : hostname());
  const accessMode = AccessModeSchema.parse(
    args.get("access") ??
      (args.has("root-path")
        ? "selected"
        : interactive
          ? await prompt(
              "Access: none (set up later), selected, home, full (trust this device)",
              "none"
            )
          : "none")
  );
  if (args.has("root-path") && accessMode !== "selected")
    throw new Error("--root-path is only used with --access selected.");
  const rootInput =
    accessMode === "selected"
      ? (args.get("root-path") ??
        (interactive ? await prompt("Folder agents may access", process.cwd()) : undefined))
      : undefined;
  const writable = !args.has("read-only") && args.get("writable") !== "false";
  const roots = await accessRoots(
    accessMode,
    writable,
    rootInput
      ? [
          await localFolder(rootInput, {
            rootId: args.get("root-id") ?? "root_workspace",
            writable
          })
        ]
      : []
  );
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await access(dirname(configPath), 2);
  const keyPair = generateNodeKeyPair();
  const client = new NodeApiClient(controlPlaneUrl, undefined, keyPair.privateKey);
  const paired = await client.pair({
    code,
    label,
    platform: process.platform === "darwin" ? "darwin" : "linux",
    publicKey: keyPair.publicKey
  });
  await saveConfig(
    ConfigSchema.parse({
      controlPlaneUrl,
      nodeId: paired.nodeId,
      accountId: paired.accountId,
      ...keyPair,
      stateDirectory: resolve(dirname(configPath), "state"),
      accessMode,
      roots,
      templates: []
    }),
    true
  );
  console.log(JSON.stringify({ paired: true, nodeId: paired.nodeId, configPath }));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "--version" || command === "version") {
    console.log(version);
    return;
  }
  if (!command || command === "--help" || command === "help") {
    console.log(usage);
    return;
  }
  if (command === "setup" || command === "pair") {
    const args = argumentsMap(process.argv.slice(3));
    if (existsSync(configPath)) {
      if (command === "pair")
        throw new Error("This device is already paired. Existing identity was preserved.");
      const config = await loadConfig();
      if (
        args.has("url") &&
        ControlPlaneUrlSchema.parse(args.get("url")) !== config.controlPlaneUrl
      ) {
        throw new Error("Already paired to a different server. Existing identity was preserved.");
      }
      // Repeating an old install command must not restore folders the owner
      // subsequently removed, or undo a newer local access decision.
      console.log(`Using existing device ${config.nodeId}. Identity and folders preserved.`);
    } else {
      await pair(args, command === "setup");
    }
    if (command === "setup" && !args.has("no-service")) await installService();
    else if (args.has("no-service"))
      console.log("Paired. Start in the foreground with adc-node run.");
    return;
  }
  if (command === "access") {
    const config = await loadConfig();
    const modeArg = process.argv[3];
    if (!modeArg) {
      console.log(JSON.stringify({ accessMode: config.accessMode, roots: config.roots }, null, 2));
      return;
    }
    const accessMode = AccessModeSchema.parse(modeArg);
    const args = argumentsMap(process.argv.slice(4));
    const roots = await accessRoots(
      accessMode,
      !args.has("read-only"),
      config.accessMode === "selected"
        ? config.roots.map((root) => (args.has("read-only") ? { ...root, writable: false } : root))
        : []
    );
    await saveConfig(ConfigSchema.parse({ ...config, accessMode, roots }));
    console.log(JSON.stringify({ accessMode, roots, reload: "automatic" }, null, 2));
    return;
  }
  if (command === "roots") {
    const config = await loadConfig();
    const action = process.argv[3] ?? "list";
    if (action === "list") {
      console.log(JSON.stringify({ accessMode: config.accessMode, roots: config.roots }, null, 2));
      return;
    }
    const value = process.argv[4];
    if (!value) throw new Error("Supply a folder path to add, or a root ID to remove.");
    if (action === "add") {
      if (config.accessMode === "full")
        throw new Error(
          "Full trust already exposes all folders. Use adc-node access selected to choose folders."
        );
      const args = argumentsMap(process.argv.slice(5));
      const root = await localFolder(value, {
        ...(args.get("root-id") ? { rootId: args.get("root-id")! } : {}),
        ...(args.get("label") ? { label: args.get("label")! } : {}),
        writable: !args.has("read-only")
      });
      const existing = config.roots.find((item) => item.path === root.path);
      if (existing) root.rootId = existing.rootId;
      if (config.roots.some((item) => item.rootId === root.rootId && item.path !== root.path))
        throw new Error("This root ID already refers to another folder.");
      config.roots = [...config.roots.filter((item) => item.rootId !== root.rootId), root];
      config.accessMode = "selected";
    } else if (action === "remove") {
      if (!config.roots.some((root) => root.rootId === value))
        throw new Error("Folder ID was not found.");
      config.roots = config.roots.filter((root) => root.rootId !== value);
      config.templates = config.templates.filter((template) => template.rootId !== value);
      config.accessMode = config.roots.length ? "selected" : "none";
    } else throw new Error("Use adc-node roots list|add|remove.");
    await saveConfig(ConfigSchema.parse(config));
    console.log(
      JSON.stringify(
        { accessMode: config.accessMode, roots: config.roots, reload: "automatic" },
        null,
        2
      )
    );
    return;
  }
  if (command === "mcp") {
    const config = await loadConfig();
    const action = process.argv[3] ?? "list";
    if (action === "list") {
      console.log(
        JSON.stringify(
          {
            providers: config.mcpProviders.map((provider) =>
              provider.transport === "stdio"
                ? {
                    providerId: provider.providerId,
                    name: provider.name,
                    transport: provider.transport,
                    command: provider.command,
                    args: provider.args,
                    cwd: provider.cwd,
                    envKeys: Object.keys(provider.env).sort()
                  }
                : {
                    providerId: provider.providerId,
                    name: provider.name,
                    transport: provider.transport,
                    url: provider.url,
                    headerNames: Object.keys(provider.headers).sort()
                  }
            )
          },
          null,
          2
        )
      );
      return;
    }
    const providerId = process.argv[4];
    if (!providerId) throw new Error("Supply an MCP Provider ID.");
    if (action === "add") {
      const args = argumentsMap(process.argv.slice(5));
      if (args.has("stdio") === args.has("http"))
        throw new Error("Choose exactly one transport: --stdio or --http.");
      if (config.mcpProviders.some((provider) => provider.providerId === providerId))
        throw new Error("This MCP Provider ID already exists.");
      const provider = McpProviderConfigSchema.parse(
        args.has("stdio")
          ? {
              providerId,
              name: args.get("name") ?? providerId,
              transport: "stdio" as const,
              command: required(args, "stdio"),
              args: jsonOption<unknown>(args, "args", []),
              env: await jsonFileOption<unknown>(args, "env-file", {}),
              ...(args.get("cwd") ? { cwd: args.get("cwd") } : {})
            }
          : {
              providerId,
              name: args.get("name") ?? providerId,
              transport: "http" as const,
              url: required(args, "http"),
              headers: await jsonFileOption<unknown>(args, "headers-file", {})
            }
      );
      config.mcpProviders.push(provider);
    } else if (action === "remove") {
      if (!config.mcpProviders.some((provider) => provider.providerId === providerId))
        throw new Error("MCP Provider ID was not found.");
      config.mcpProviders = config.mcpProviders.filter(
        (provider) => provider.providerId !== providerId
      );
    } else throw new Error("Use adc-node mcp list|add|remove.");
    const validated = ConfigSchema.parse(config);
    await saveConfig(validated);
    console.log(
      JSON.stringify({
        providerId,
        action: action === "add" ? "added" : "removed",
        reload: "automatic"
      })
    );
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(await serviceStatus(), null, 2));
    return;
  }
  if (command === "start") {
    await startService();
    return;
  }
  if (command === "stop") {
    await stopService();
    return;
  }
  if (command === "restart") {
    await stopService();
    await startService();
    return;
  }
  if (command === "logs") {
    await showLogs();
    return;
  }
  if (command === "uninstall") {
    await uninstall();
    return;
  }
  if (command === "unpair") {
    const config = await loadConfig();
    const args = argumentsMap(process.argv.slice(3));
    if (required(args, "confirm") !== config.nodeId)
      throw new Error("Confirmation must exactly match the current device ID.");
    await stopService();
    await rm(configPath);
    console.log(
      JSON.stringify({
        unpaired: true,
        nodeId: config.nodeId,
        receiptsPreservedAt: config.stateDirectory,
        next: "Create a new pairing code and run the installer again."
      })
    );
    return;
  }
  if (command === "rotate-key") {
    const config = await loadConfig();
    const next = generateNodeKeyPair();
    const client = new NodeApiClient(config.controlPlaneUrl, config.nodeId, config.privateKey);
    await client.rotateKey(next.publicKey);
    await saveConfig(ConfigSchema.parse({ ...config, ...next }));
    if ((await serviceStatus()).registered) {
      await stopService();
      await startService();
    }
    console.log(JSON.stringify({ rotated: true, nodeId: config.nodeId }));
    return;
  }
  if (command === "run") {
    const config = await loadConfig();
    const daemon = new NodeDaemon({
      ...config,
      nodeVersion: version,
      loadAccess: async () => {
        const current = await loadConfig();
        if (
          ["nodeId", "accountId", "controlPlaneUrl", "privateKey", "stateDirectory"].some(
            (field) =>
              current[field as keyof typeof current] !== config[field as keyof typeof config]
          )
        )
          throw new Error("Device identity changed; restart the connector.");
        return current;
      }
    });
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    await daemon.run(abort.signal);
    return;
  }
  throw new Error(usage);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
