import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import {
  type AccessProfile,
  type AccessSettings,
  type AdcClient,
  type AgentAccess,
  type ApprovalPolicy,
  type ManagedNode,
  type NodeAccessPolicy,
  type Project,
  type ProjectRoot
} from "@adc/client";
import type { ToolId } from "@adc/protocol";
import { importToken } from "./auth.ts";

type Flags = Map<string, string | true>;

const readTools = [
  "device.list",
  "device.status",
  "file.list",
  "file.read",
  "file.search",
  "command.template.list",
  "task.status",
  "task.result"
] as ToolId[];
const writeTools = ["file.write", "file.edit", "file.patch"] as ToolId[];
const runTools = ["shell.exec", "command.template.run", "test.run", "task.cancel"] as ToolId[];
const toolPresets: Record<string, ToolId[]> = {
  read: readTools,
  write: [...readTools, ...writeTools],
  run: [...readTools, ...writeTools, ...runTools],
  templates: [...readTools, "command.template.run", "test.run", "task.cancel"]
};

export const managementUsage = `Account management:
  adc device add [--name NAME] [--ttl SECONDS] [--access none|home|full]
  adc device list | show DEVICE
  adc device update DEVICE [--name NAME] [--folders all|none|LIST]
                    [--read-only none|LIST] [--execution on|off]
                    [--concurrency 1..32] [--file JSON]
  adc device wait DEVICE [--timeout SECONDS]
  adc device revoke|remove DEVICE --yes
  adc access create --name NAME [--devices LIST] [--folders all|none|LIST]
                    [--capabilities read|write|run|templates] [--tools LIST]
                    [--approval never|writes|execute|always] [--project PROJECT]
                    [--file JSON]
  adc access list | show ACCESS
  adc access update ACCESS [same options as create]
  adc access revoke|remove ACCESS --yes
  adc connect ACCESS [--name NAME] [--expires DAYS]
  adc connection list | revoke CONNECTION --yes
  adc approval list | approve|deny APPROVAL
  adc project list | create --name NAME
  adc project roots PROJECT
  adc project root-add PROJECT --device DEVICE --folder FOLDER [--name NAME] [--read-only]

DEVICE, ACCESS, PROJECT, CONNECTION and FOLDER accept an exact ID or unambiguous name/path.`;

export function isManagementCommand(
  domain: string | undefined,
  action: string | undefined,
  flags: Flags
): boolean {
  if (!domain) return false;
  if (["device", "access", "connect", "connection", "approval", "project"].includes(domain))
    return true;
  if (domain === "audit") return true;
  return domain === "node" && (action === "pairing-code" || flags.has("session"));
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requiredFlag(flags: Flags, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function nodeConcurrency(value: string): number {
  const parsed = positiveInteger(value, 6, "concurrency");
  if (parsed > 32) throw new Error("--concurrency must be between 1 and 32");
  return parsed;
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanFlag(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return;
  if (["on", "true", "yes", "1"].includes(value)) return true;
  if (["off", "false", "no", "0"].includes(value)) return false;
  throw new Error(`--${name} must be on or off`);
}

function requireConfirmation(flags: Flags): void {
  if (!flags.has("yes")) throw new Error("This is destructive. Re-run with --yes.");
}

async function fileInput(flags: Flags): Promise<Record<string, unknown>> {
  const path = stringFlag(flags, "file");
  if (!path) return {};
  const value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("--file must contain a JSON object");
  return value as Record<string, unknown>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function selectOne<T>(
  values: T[],
  selector: string,
  id: (value: T) => string,
  label: (value: T) => string,
  kind: string
): T {
  const direct = values.find((value) => id(value) === selector);
  if (direct) return direct;
  const exact = values.filter((value) => label(value).toLowerCase() === selector.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error(`${kind} name is ambiguous; use its ID.`);
  throw new Error(`${kind} was not found: ${selector}`);
}

function selectMany<T>(
  values: T[],
  selectors: string[],
  id: (value: T) => string,
  label: (value: T) => string,
  kind: string
): T[] {
  return selectors.map((selector) => selectOne(values, selector, id, label, kind));
}

function publicNode(node: ManagedNode) {
  return {
    id: node.nodeId,
    name: node.label,
    platform: node.platform,
    status: node.status,
    online: node.online,
    revision: node.revision ?? 1,
    lastSeenAt: node.lastSeenAt ?? null,
    createdAt: node.createdAt,
    accessMode: node.capability?.accessMode ?? "selected",
    policy: {
      rootAccess: "all",
      rootIds: [],
      readOnlyRootIds: [],
      allowExecution: true,
      maxConcurrency: 6,
      ...node.accessPolicy
    } satisfies NodeAccessPolicy,
    folders: (node.effectiveCapability ?? node.capability)?.roots ?? [],
    tools: (node.effectiveCapability ?? node.capability)?.tools ?? []
  };
}

function publicAccess(access: AgentAccess) {
  return {
    id: access.grantId,
    name: access.name,
    projectId: access.projectId ?? null,
    deviceIds: access.nodeIds,
    folderAccess: access.rootAccess ?? "selected",
    folderIds: access.rootIds,
    foldersByDevice: access.resourcesByNode ?? {},
    capabilities: access.allowedTools,
    approval: access.approvalPolicy ?? null,
    profile: access.profile,
    status: access.revokedAt ? "revoked" : "active",
    revision: access.revision ?? 1,
    createdAt: access.createdAt
  };
}

async function resolveNodes(client: AdcClient, selectors: string[]): Promise<ManagedNode[]> {
  const nodes = await client.listNodes();
  return selectMany(
    nodes,
    selectors,
    (node) => node.nodeId,
    (node) => node.label,
    "Device"
  );
}

async function resolveAccess(client: AdcClient, selector: string): Promise<AgentAccess> {
  return selectOne(
    await client.listAccess(),
    selector,
    (access) => access.grantId,
    (access) => access.name,
    "Access"
  );
}

async function resolveProject(client: AdcClient, selector: string): Promise<Project> {
  return selectOne(
    await client.listProjects(),
    selector,
    (project) => project.projectId,
    (project) => project.label,
    "Project"
  );
}

function availableRoots(nodes: ManagedNode[]): ProjectRoot[] {
  return nodes.flatMap((node) =>
    (node.capability?.roots ?? []).map((root) => ({
      rootId: root.rootId,
      label: root.label,
      writable: root.writable,
      ...(root.path ? { path: root.path } : {}),
      projectId: "",
      nodeId: node.nodeId,
      createdAt: ""
    }))
  );
}

function resolveRootIds(roots: ProjectRoot[], selectors: string[]): string[] {
  const selected = selectors.map((selector) => {
    const id = roots.find((root) => root.rootId === selector);
    if (id) return id;
    const exact = roots.filter(
      (root) =>
        root.path?.toLowerCase() === selector.toLowerCase() ||
        root.label.toLowerCase() === selector.toLowerCase()
    );
    if (exact.length === 1) return exact[0]!;
    if (exact.length > 1) throw new Error("Folder name is ambiguous; use its path or ID.");
    throw new Error(`Folder was not found: ${selector}`);
  });
  return [...new Set(selected.map((root) => root.rootId))];
}

async function accessSettings(
  client: AdcClient,
  flags: Flags,
  defaults?: AccessSettings
): Promise<AccessSettings> {
  const input = await fileInput(flags);
  const projectSelector = stringFlag(flags, "project");
  const project =
    projectSelector && projectSelector !== "none"
      ? await resolveProject(client, projectSelector)
      : undefined;
  const projectId =
    projectSelector === "none"
      ? undefined
      : (project?.projectId ?? (input.projectId as string | undefined) ?? defaults?.projectId);
  const deviceSelectors = csv(stringFlag(flags, "devices"));
  const nodes = await client.listNodes();
  const nodeIds = deviceSelectors
    ? selectMany(
        nodes,
        deviceSelectors,
        (node) => node.nodeId,
        (node) => node.label,
        "Device"
      ).map((node) => node.nodeId)
    : ((input.nodeIds as string[] | undefined) ?? defaults?.nodeIds ?? []);
  const selectedNodes = nodes.filter((node) => nodeIds.includes(node.nodeId));
  if (!projectId && !nodeIds.length) throw new Error("--devices is required for direct access");

  const folderFlag = stringFlag(flags, "folders");
  let rootAccess =
    (input.rootAccess as "selected" | "all" | undefined) ??
    defaults?.rootAccess ??
    (projectId ? "selected" : "all");
  let rootIds = (input.rootIds as string[] | undefined) ?? defaults?.rootIds ?? [];
  if (folderFlag) {
    if (folderFlag === "all") {
      rootAccess = "all";
      rootIds = [];
    } else if (folderFlag === "none") {
      rootAccess = "selected";
      rootIds = [];
    } else {
      rootAccess = "selected";
      const roots = projectId
        ? await client.listProjectRoots(projectId)
        : availableRoots(selectedNodes);
      rootIds = resolveRootIds(roots, csv(folderFlag)!);
    }
  }
  if (projectId && rootAccess === "all")
    throw new Error(
      "Project access requires selected folders; use --folders none or a folder list."
    );

  const preset = stringFlag(flags, "capabilities");
  if (preset && !toolPresets[preset])
    throw new Error("--capabilities must be read, write, run or templates");
  const explicitTools = csv(stringFlag(flags, "tools"));
  const allowedTools = (explicitTools ??
    (preset ? toolPresets[preset] : undefined) ??
    (input.allowedTools as ToolId[] | undefined) ??
    defaults?.allowedTools ??
    toolPresets.read) as ToolId[];
  const profile = (stringFlag(flags, "profile") ??
    input.profile ??
    (preset === "read" ? "read-only" : undefined) ??
    defaults?.profile ??
    "workspace-write") as AccessProfile;
  const approvalPolicy = (stringFlag(flags, "approval") ??
    input.approvalPolicy ??
    defaults?.approvalPolicy ??
    "never") as ApprovalPolicy;
  if (!["read-only", "workspace-write", "approve-required", "unattended"].includes(profile))
    throw new Error("Invalid --profile");
  if (!["never", "writes", "execute", "always"].includes(approvalPolicy))
    throw new Error("Invalid --approval");

  return {
    name:
      stringFlag(flags, "name") ??
      (input.name as string | undefined) ??
      defaults?.name ??
      "Agent access",
    ...(projectId ? { projectId } : {}),
    profile,
    nodeIds,
    rootAccess,
    rootIds,
    approvalPolicy,
    allowedTools
  };
}

function nodePolicy(node: ManagedNode): NodeAccessPolicy {
  return {
    rootAccess: "all",
    rootIds: [],
    readOnlyRootIds: [],
    allowExecution: true,
    maxConcurrency: 6,
    ...node.accessPolicy
  };
}

async function updateDevice(client: AdcClient, node: ManagedNode, flags: Flags) {
  const input = await fileInput(flags);
  const inputPolicy = input.accessPolicy as Partial<NodeAccessPolicy> | undefined;
  const policy = { ...nodePolicy(node), ...inputPolicy };
  const roots = availableRoots([node]);
  const folders = stringFlag(flags, "folders");
  if (folders === "all") {
    policy.rootAccess = "all";
    policy.rootIds = [];
  } else if (folders === "none") {
    policy.rootAccess = "selected";
    policy.rootIds = [];
  } else if (folders) {
    policy.rootAccess = "selected";
    policy.rootIds = resolveRootIds(roots, csv(folders)!);
  }
  const readOnly = stringFlag(flags, "read-only");
  if (readOnly === "none") policy.readOnlyRootIds = [];
  else if (readOnly) policy.readOnlyRootIds = resolveRootIds(roots, csv(readOnly)!);
  const execution = booleanFlag(stringFlag(flags, "execution"), "execution");
  if (execution !== undefined) policy.allowExecution = execution;
  const concurrency = stringFlag(flags, "concurrency");
  if (concurrency !== undefined) policy.maxConcurrency = nodeConcurrency(concurrency);
  if (policy.rootAccess === "all") policy.rootIds = [];
  return client.updateNode(node.nodeId, {
    revision: node.revision ?? 1,
    label: stringFlag(flags, "name") ?? (input.label as string | undefined) ?? node.label,
    accessPolicy: policy
  });
}

export async function runManagementCommand(input: {
  domain: string;
  action: string | undefined;
  positionals: string[];
  flags: Flags;
  client: AdcClient;
  url: string;
}): Promise<{ handled: boolean; value?: unknown }> {
  const { domain, action, positionals, flags, client, url } = input;
  if (domain === "device") {
    if (action === "add") {
      const pairing = await client.createPairingCode(
        positiveInteger(stringFlag(flags, "ttl"), 600, "ttl")
      );
      const installation = await client.nodeInstallation();
      const setupArgs = [
        `--url ${shellQuote(installation.controlPlaneUrl ?? url)}`,
        ...(installation.downloadUrl
          ? [`--download-url ${shellQuote(installation.downloadUrl)}`]
          : []),
        `--code ${shellQuote(pairing.code)}`,
        ...(stringFlag(flags, "name") ? [`--label ${shellQuote(stringFlag(flags, "name")!)}`] : []),
        ...(stringFlag(flags, "access")
          ? [`--access ${shellQuote(stringFlag(flags, "access")!)}`]
          : []),
        ...(stringFlag(flags, "root")
          ? [`--root-path ${shellQuote(stringFlag(flags, "root")!)}`]
          : []),
        ...(flags.has("read-only") ? ["--read-only"] : []),
        ...(flags.has("no-service") ? ["--no-service"] : [])
      ].join(" ");
      const installCommand =
        installation.available && installation.installerUrl
          ? `curl -fsSL ${shellQuote(installation.installerUrl)} | sh -s -- ${setupArgs}`
          : `adc-node setup ${setupArgs}`;
      return {
        handled: true,
        value: { schemaVersion: "0.1", expiresAt: pairing.expiresAt, installCommand }
      };
    }
    if (action === "list") {
      return {
        handled: true,
        value: { schemaVersion: "0.1", devices: (await client.listNodes()).map(publicNode) }
      };
    }
    if (action === "show") {
      const selector = positionals[2];
      if (!selector) throw new Error("device name or ID is required");
      const node = selectOne(
        await client.listNodes(),
        selector,
        (value) => value.nodeId,
        (value) => value.label,
        "Device"
      );
      return { handled: true, value: { schemaVersion: "0.1", device: publicNode(node) } };
    }
    if (action === "update") {
      const selector = positionals[2];
      if (!selector) throw new Error("device name or ID is required");
      const node = selectOne(
        await client.listNodes(),
        selector,
        (value) => value.nodeId,
        (value) => value.label,
        "Device"
      );
      return {
        handled: true,
        value: { schemaVersion: "0.1", device: publicNode(await updateDevice(client, node, flags)) }
      };
    }
    if (action === "wait") {
      const selector = positionals[2];
      if (!selector) throw new Error("device name or ID is required");
      const deadline =
        Date.now() + positiveInteger(stringFlag(flags, "timeout"), 120, "timeout") * 1000;
      while (Date.now() < deadline) {
        const nodes = await client.listNodes();
        const node = nodes.find(
          (value) =>
            (value.nodeId === selector || value.label.toLowerCase() === selector.toLowerCase()) &&
            value.online
        );
        if (node)
          return { handled: true, value: { schemaVersion: "0.1", device: publicNode(node) } };
        await new Promise((done) => setTimeout(done, 2000));
      }
      throw new Error(`Timed out waiting for device: ${selector}`);
    }
    if (action === "revoke" || action === "remove") {
      requireConfirmation(flags);
      const selector = positionals[2];
      if (!selector) throw new Error("device name or ID is required");
      const node = selectOne(
        await client.listNodes(),
        selector,
        (value) => value.nodeId,
        (value) => value.label,
        "Device"
      );
      const result =
        action === "revoke"
          ? await client.revokeNode(node.nodeId)
          : await client.deleteNode(node.nodeId, node.revision ?? 1);
      return { handled: true, value: { schemaVersion: "0.1", ...result, id: node.nodeId } };
    }
    return { handled: false };
  }

  if (domain === "access") {
    if (action === "list") {
      return {
        handled: true,
        value: { schemaVersion: "0.1", access: (await client.listAccess()).map(publicAccess) }
      };
    }
    if (action === "show") {
      const selector = positionals[2];
      if (!selector) throw new Error("access name or ID is required");
      return {
        handled: true,
        value: { schemaVersion: "0.1", access: publicAccess(await resolveAccess(client, selector)) }
      };
    }
    if (action === "create") {
      const settings = await accessSettings(client, flags);
      return {
        handled: true,
        value: { schemaVersion: "0.1", access: publicAccess(await client.createAccess(settings)) }
      };
    }
    if (action === "update") {
      const selector = positionals[2];
      if (!selector) throw new Error("access name or ID is required");
      const previous = await resolveAccess(client, selector);
      const settings = await accessSettings(client, flags, previous);
      return {
        handled: true,
        value: {
          schemaVersion: "0.1",
          access: publicAccess(
            await client.updateAccess(previous.grantId, {
              ...settings,
              revision: previous.revision ?? 1
            })
          )
        }
      };
    }
    if (action === "revoke" || action === "remove") {
      requireConfirmation(flags);
      const selector = positionals[2];
      if (!selector) throw new Error("access name or ID is required");
      const access = await resolveAccess(client, selector);
      const result =
        action === "revoke"
          ? await client.revokeAccess(access.grantId)
          : await client.deleteAccess(access.grantId, access.revision ?? 1);
      return { handled: true, value: { schemaVersion: "0.1", ...result, id: access.grantId } };
    }
    return { handled: false };
  }

  if (domain === "connect") {
    const selector = action;
    if (!selector) throw new Error("access name or ID is required");
    const access = await resolveAccess(client, selector);
    if (access.revokedAt) throw new Error("Cannot connect revoked access.");
    const created = await client.createConnection({
      name: stringFlag(flags, "name") ?? `ADC CLI on ${hostname()}`,
      grantId: access.grantId,
      expiresInDays: positiveInteger(stringFlag(flags, "expires"), 30, "expires")
    });
    try {
      await importToken(url, created.token);
    } catch (error) {
      await client.revokeConnection(created.credential.credentialId).catch(() => undefined);
      throw error;
    }
    return {
      handled: true,
      value: {
        schemaVersion: "0.1",
        connected: true,
        access: { id: access.grantId, name: access.name },
        connection: {
          id: created.credential.credentialId,
          name: created.credential.name,
          expiresAt: created.credential.expiresAt
        }
      }
    };
  }

  if (domain === "connection") {
    if (action === "list") {
      const [cli, oauth] = await Promise.all([
        client.listConnections(),
        client.listOAuthConnections()
      ]);
      return {
        handled: true,
        value: {
          schemaVersion: "0.1",
          connections: [
            ...cli.map((connection) => ({
              type: "cli",
              id: connection.credentialId,
              name: connection.name,
              accessId: connection.grantId,
              expiresAt: connection.expiresAt,
              lastUsedAt: connection.lastUsedAt,
              status: connection.revokedAt
                ? "revoked"
                : Date.parse(connection.expiresAt) <= Date.now()
                  ? "expired"
                  : "active"
            })),
            ...oauth.map((connection) => ({
              type: "mcp",
              id: connection.clientId,
              accessId: connection.grantId,
              createdAt: connection.createdAt,
              status: connection.revokedAt ? "revoked" : "active"
            }))
          ]
        }
      };
    }
    if (action === "revoke") {
      requireConfirmation(flags);
      const selector = positionals[2];
      if (!selector) throw new Error("connection name or ID is required");
      const cli = await client.listConnections();
      const direct = cli.find((connection) => connection.credentialId === selector);
      const named = cli.filter(
        (connection) => connection.name.toLowerCase() === selector.toLowerCase()
      );
      if (direct || named.length === 1) {
        const connection = direct ?? named[0]!;
        await client.revokeConnection(connection.credentialId);
        return {
          handled: true,
          value: { schemaVersion: "0.1", revoked: true, id: connection.credentialId }
        };
      }
      if (named.length > 1) throw new Error("Connection name is ambiguous; use its ID.");
      const oauth = await client.listOAuthConnections();
      const binding = oauth.find((connection) => connection.clientId === selector);
      if (!binding) throw new Error(`Connection was not found: ${selector}`);
      await client.revokeOAuthConnection(binding.clientId);
      return {
        handled: true,
        value: { schemaVersion: "0.1", revoked: true, id: binding.clientId }
      };
    }
    return { handled: false };
  }

  if (domain === "approval") {
    if (action === "list") {
      return {
        handled: true,
        value: { schemaVersion: "0.1", approvals: await client.listApprovals() }
      };
    }
    if (action === "approve" || action === "deny") {
      const approvalId = positionals[2];
      if (!approvalId) throw new Error("approval ID is required");
      return {
        handled: true,
        value: await client.resolveApproval(
          approvalId,
          action === "approve" ? "approved" : "denied"
        )
      };
    }
    return { handled: false };
  }

  if (domain === "project") {
    if (action === "list") {
      return {
        handled: true,
        value: {
          schemaVersion: "0.1",
          projects: (await client.listProjects()).map((project) => ({
            id: project.projectId,
            name: project.label,
            createdAt: project.createdAt
          }))
        }
      };
    }
    if (action === "create") {
      const project = await client.createProject({ label: requiredFlag(flags, "name") });
      return {
        handled: true,
        value: {
          schemaVersion: "0.1",
          project: { id: project.projectId, name: project.label, createdAt: project.createdAt }
        }
      };
    }
    if (action === "roots") {
      const selector = positionals[2];
      if (!selector) throw new Error("project name or ID is required");
      const project = await resolveProject(client, selector);
      return {
        handled: true,
        value: {
          schemaVersion: "0.1",
          folders: await client.listProjectRoots(project.projectId)
        }
      };
    }
    if (action === "root-add") {
      const selector = positionals[2];
      if (!selector) throw new Error("project name or ID is required");
      const project = await resolveProject(client, selector);
      const node = (await resolveNodes(client, [requiredFlag(flags, "device")]))[0]!;
      const root = selectOne(
        availableRoots([node]),
        requiredFlag(flags, "folder"),
        (value) => value.rootId,
        (value) => value.path ?? value.label,
        "Folder"
      );
      const created = await client.addProjectRoot(project.projectId, {
        rootId: root.rootId,
        nodeId: node.nodeId,
        label: stringFlag(flags, "name") ?? root.label,
        writable: root.writable && !flags.has("read-only")
      });
      return { handled: true, value: { schemaVersion: "0.1", folder: created } };
    }
    return { handled: false };
  }

  return { handled: false };
}
