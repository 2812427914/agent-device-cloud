import { link, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";
import { McpProviderIdSchema, RootIdSchema } from "@adc/protocol";

export const AccessModeSchema = z.enum(["none", "selected", "home", "full"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const ControlPlaneUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "Use an HTTPS origin, or HTTP on loopback for local development.")
  .transform((value) => new URL(value).origin);

const ProviderBaseSchema = z.object({
  providerId: McpProviderIdSchema,
  name: z.string().trim().min(1).max(128)
});

export const McpProviderConfigSchema = z.discriminatedUnion("transport", [
  ProviderBaseSchema.extend({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(8192)).max(128).default([]),
    env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(32_768)).default({}),
    cwd: z.string().startsWith("/").optional()
  }).strict(),
  ProviderBaseSchema.extend({
    transport: z.literal("http"),
    url: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          !url.username &&
          !url.password &&
          !url.hash &&
          (url.protocol === "https:" ||
            (url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
        );
      }, "Use HTTPS, or HTTP on loopback for a local MCP server."),
    headers: z.record(z.string().min(1).max(256), z.string().max(32_768)).default({})
  }).strict()
]);
export type McpProviderConfig = z.infer<typeof McpProviderConfigSchema>;

export const CommandTemplateSchema = z
  .object({
    projectId: z
      .string()
      .regex(/^proj_[a-z0-9][a-z0-9_-]{2,127}$/)
      .optional(),
    templateId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
    rootId: RootIdSchema,
    command: z.string().trim().min(1).max(16_384),
    timeoutMs: z.number().int().min(1_000).max(3_600_000),
    readOnly: z.boolean()
  })
  .strict();

export const ConfigSchema = z
  .object({
    controlPlaneUrl: ControlPlaneUrlSchema,
    nodeId: z.string(),
    accountId: z.string(),
    privateKey: z.string(),
    publicKey: z.string(),
    stateDirectory: z.string(),
    accessMode: AccessModeSchema.default("selected"),
    roots: z
      .array(
        z
          .object({
            rootId: RootIdSchema,
            path: z.string().startsWith("/"),
            writable: z.boolean(),
            label: z.string().min(1).max(128).optional()
          })
          .strict()
      )
      .max(64),
    templates: z.array(CommandTemplateSchema).max(128).default([]),
    mcpProviders: z.array(McpProviderConfigSchema).max(32).default([])
  })
  .strict()
  .superRefine((config, context) => {
    if (new Set(config.roots.map((root) => root.rootId)).size !== config.roots.length)
      context.addIssue({ code: "custom", path: ["roots"], message: "Folder IDs must be unique." });
    if (
      new Set(config.mcpProviders.map((provider) => provider.providerId)).size !==
      config.mcpProviders.length
    )
      context.addIssue({
        code: "custom",
        path: ["mcpProviders"],
        message: "MCP Provider IDs must be unique."
      });
    if (
      new Set(
        config.templates.map(
          (template) => `${template.projectId ?? ""}:${template.rootId}:${template.templateId}`
        )
      ).size !== config.templates.length
    )
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: "Template IDs must be unique within a project and folder."
      });
    if (config.accessMode === "none" && config.roots.length)
      context.addIssue({
        code: "custom",
        path: ["roots"],
        message: "No-access mode must have no folders."
      });
  });

export type NodeConfig = z.infer<typeof ConfigSchema>;

export async function localFolder(
  path: string,
  options: {
    rootId?: string;
    label?: string;
    writable?: boolean;
  } = {}
): Promise<NodeConfig["roots"][number]> {
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isDirectory())
    throw new Error("The selected root must be a folder.");
  return {
    rootId: RootIdSchema.parse(
      options.rootId ?? `root_${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`
    ),
    label: options.label ?? (basename(canonical) || "All files"),
    path: canonical,
    writable: options.writable ?? true
  };
}

export async function accessRoots(
  mode: AccessMode,
  writable = true,
  selected: NodeConfig["roots"] = []
): Promise<NodeConfig["roots"]> {
  if (mode === "none") return [];
  if (mode === "selected") return selected;
  return [
    await localFolder(mode === "home" ? homedir() : "/", {
      rootId: mode === "home" ? "root_home" : "root_device",
      label: mode === "home" ? "Home" : "All files",
      writable
    })
  ];
}

export const configPath = resolve(
  process.env.ADC_NODE_CONFIG ?? resolve(homedir(), ".config", "adc", "node.json")
);

export async function loadConfig() {
  return ConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
}

export async function saveConfig(
  config: z.infer<typeof ConfigSchema>,
  createOnly = false
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
  try {
    if (createOnly) await link(temporary, configPath);
    else await rename(temporary, configPath);
  } finally {
    await rm(temporary, { force: true });
  }
}
