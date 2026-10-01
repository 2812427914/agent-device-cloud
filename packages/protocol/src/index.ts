import { randomBytes } from "node:crypto";
import { z } from "zod";

export const PROTOCOL_VERSION = "0.1" as const;

export const ErrorCodes = {
  INVALID_REQUEST: "invalid_request",
  UNSUPPORTED_VERSION: "unsupported_version",
  EXPIRED: "expired",
  DENIED: "denied",
  APPROVAL_REQUIRED: "approval_required",
  OFFLINE: "offline",
  AMBIGUOUS_TARGET: "ambiguous_target",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  LEASE_EXPIRED: "lease_expired",
  UNKNOWN_OUTCOME: "unknown_outcome",
  EXECUTION_FAILED: "execution_failed",
  CANCELLED: "cancelled",
  INTERNAL: "internal"
} as const;

export const ErrorCodeSchema = z.enum(Object.values(ErrorCodes));
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const idBody = /^[a-z0-9][a-z0-9_-]{2,127}$/;
export const AccountIdSchema = z.string().regex(/^acct_[a-z0-9][a-z0-9_-]{2,127}$/);
export const ActorIdSchema = z.string().regex(/^actor_[a-z0-9][a-z0-9_-]{2,127}$/);
export const NodeIdSchema = z.string().regex(/^node_[a-z0-9][a-z0-9_-]{2,127}$/);
export const ProjectIdSchema = z.string().regex(/^proj_[a-z0-9][a-z0-9_-]{2,127}$/);
export const RootIdSchema = z.string().regex(/^root_[a-z0-9][a-z0-9_-]{2,127}$/);
export const InvocationIdSchema = z.string().regex(/^inv_[a-z0-9][a-z0-9_-]{2,127}$/);
export const AttemptIdSchema = z.string().regex(/^att_[a-z0-9][a-z0-9_-]{2,127}$/);
export const DispatchIdSchema = z.string().regex(/^dsp_[a-z0-9][a-z0-9_-]{2,127}$/);
export const ApprovalIdSchema = z.string().regex(/^apr_[a-z0-9][a-z0-9_-]{2,127}$/);
export const ReceiptIdSchema = z.string().regex(/^rcpt_[a-z0-9][a-z0-9_-]{2,127}$/);
export const JobIdSchema = z.string().regex(/^job_[a-z0-9][a-z0-9_-]{2,127}$/);
export const NodePlatformSchema = z.enum(["darwin", "linux", "win32", "android"]);
export type NodePlatform = z.infer<typeof NodePlatformSchema>;

export const NodeWakeSignalSchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("dispatch.available"),
    nodeId: NodeIdSchema,
    issuedAt: z.iso.datetime({ offset: true })
  })
  .strict();
export type NodeWakeSignal = z.infer<typeof NodeWakeSignalSchema>;

export const ResourcePathSchema = z
  .string()
  .max(4096)
  .superRefine((value, context) => {
    if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
      context.addIssue({ code: "custom", message: "resource path must be relative POSIX syntax" });
      return;
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
      if (value !== "") {
        context.addIssue({ code: "custom", message: "resource path contains an unsafe segment" });
      }
    }
  });

export const AbsolutePathSchema = z
  .string()
  .max(4096)
  .superRefine((value, context) => {
    if (value.includes("\0") || value.includes("\\") || !value.startsWith("/")) {
      context.addIssue({ code: "custom", message: "path must use absolute POSIX syntax" });
      return;
    }
    if (
      value !== "/" &&
      value
        .slice(1)
        .split("/")
        .some((segment) => segment === "." || segment === ".." || segment === "")
    ) {
      context.addIssue({ code: "custom", message: "absolute path contains an unsafe segment" });
    }
  });

export interface AdvertisedRootPath {
  rootId: string;
  path?: string | undefined;
}

export function containsAbsolutePath(rootPath: string, absolutePath: string): boolean {
  return (
    rootPath === "/" ||
    absolutePath === rootPath ||
    absolutePath.startsWith(`${rootPath.replace(/\/+$/, "")}/`)
  );
}

export function rootForAbsolutePath<T extends AdvertisedRootPath>(
  absolutePath: string,
  roots: readonly T[]
): T | undefined {
  AbsolutePathSchema.parse(absolutePath);
  return roots
    .filter(
      (root): root is T & { path: string } =>
        typeof root.path === "string" && containsAbsolutePath(root.path, absolutePath)
    )
    .sort(
      (left, right) =>
        right.path.length - left.path.length || left.rootId.localeCompare(right.rootId)
    )[0];
}

export function relativePathFromRoot(rootPath: string, absolutePath: string): string {
  if (!containsAbsolutePath(rootPath, absolutePath)) {
    throw new Error("absolute path is outside the selected root");
  }
  if (rootPath === "/") return absolutePath.slice(1);
  if (rootPath === absolutePath) return "";
  return absolutePath.slice(rootPath.replace(/\/+$/, "").length + 1);
}

const NonEmptyResourcePathSchema = ResourcePathSchema.pipe(z.string().min(1));

const LegacyRootPathShape = {
  rootId: RootIdSchema,
  path: ResourcePathSchema
} as const;
const AbsolutePathShape = { path: AbsolutePathSchema } as const;
const LegacyRootFileShape = {
  rootId: RootIdSchema,
  path: NonEmptyResourcePathSchema
} as const;
const AbsoluteFileShape = { path: AbsolutePathSchema } as const;

const FileListOptions = {
  glob: z.string().min(1).max(512).optional(),
  maxEntries: z.number().int().min(1).max(10_000).default(1000)
} as const;
const FileReadOptions = {
  encoding: z.literal("utf8").default("utf8"),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(1024 * 1024)
} as const;
const FileSearchOptions = {
  query: z.string().min(1).max(1000),
  glob: z.string().min(1).max(512).optional(),
  maxMatches: z.number().int().min(1).max(10_000).default(1000)
} as const;
const FileWriteOptions = {
  content: z.string().max(10 * 1024 * 1024),
  createOnly: z.boolean().default(false)
} as const;
const FileEditOptions = {
  oldText: z.string().min(1),
  newText: z.string(),
  replaceAll: z.boolean().default(false)
} as const;
const FilePatchOptions = {
  patch: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024)
} as const;
const ShellOptions = {
  command: z.string().min(1).max(32_768),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(30 * 60 * 1000)
    .default(120_000),
  env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(8192)).default({})
} as const;

export const ToolArgsSchemas = {
  "device.list": z.object({}).strict(),
  "device.status": z.object({ nodeId: NodeIdSchema }).strict(),
  "device.battery.get": z.object({}).strict(),
  "device.network.get": z.object({}).strict(),
  "location.get": z
    .object({
      desiredAccuracy: z.enum(["coarse", "balanced", "precise"]).default("balanced"),
      maxAgeMs: z
        .number()
        .int()
        .min(0)
        .max(10 * 60 * 1000)
        .default(15_000),
      timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000)
    })
    .strict(),
  "notification.show": z
    .object({
      title: z.string().trim().min(1).max(120),
      body: z.string().max(2000)
    })
    .strict(),
  "file.list": z.union([
    z.object({ ...LegacyRootPathShape, ...FileListOptions }).strict(),
    z.object({ ...AbsolutePathShape, ...FileListOptions }).strict()
  ]),
  "file.read": z.union([
    z.object({ ...LegacyRootFileShape, ...FileReadOptions }).strict(),
    z.object({ ...AbsoluteFileShape, ...FileReadOptions }).strict()
  ]),
  "file.search": z.union([
    z.object({ ...LegacyRootPathShape, ...FileSearchOptions }).strict(),
    z.object({ ...AbsolutePathShape, ...FileSearchOptions }).strict()
  ]),
  "file.write": z.union([
    z.object({ ...LegacyRootFileShape, ...FileWriteOptions }).strict(),
    z.object({ ...AbsoluteFileShape, ...FileWriteOptions }).strict()
  ]),
  "file.edit": z.union([
    z.object({ ...LegacyRootFileShape, ...FileEditOptions }).strict(),
    z.object({ ...AbsoluteFileShape, ...FileEditOptions }).strict()
  ]),
  "file.patch": z.union([
    z.object({ ...LegacyRootFileShape, ...FilePatchOptions }).strict(),
    z.object({ ...AbsoluteFileShape, ...FilePatchOptions }).strict()
  ]),
  "shell.exec": z.union([
    z.object({ rootId: RootIdSchema, cwd: ResourcePathSchema, ...ShellOptions }).strict(),
    z.object({ cwd: AbsolutePathSchema, ...ShellOptions }).strict()
  ]),
  "command.template.list": z.object({ projectId: ProjectIdSchema.optional() }).strict(),
  "command.template.run": z.union([
    z
      .object({
        projectId: ProjectIdSchema.optional(),
        rootId: RootIdSchema,
        templateId: z.string().regex(idBody),
        parameters: z.record(z.string(), z.string().max(8192)).default({})
      })
      .strict(),
    z
      .object({
        projectId: ProjectIdSchema.optional(),
        cwd: AbsolutePathSchema,
        templateId: z.string().regex(idBody),
        parameters: z.record(z.string(), z.string().max(8192)).default({})
      })
      .strict()
  ]),
  "test.run": z.union([
    z
      .object({
        projectId: ProjectIdSchema.optional(),
        rootId: RootIdSchema,
        templateId: z.string().regex(idBody).default("test"),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(30 * 60 * 1000)
          .default(300_000)
      })
      .strict(),
    z
      .object({
        projectId: ProjectIdSchema.optional(),
        cwd: AbsolutePathSchema,
        templateId: z.string().regex(idBody).default("test"),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(30 * 60 * 1000)
          .default(300_000)
      })
      .strict()
  ]),
  "task.status": z.object({ jobId: JobIdSchema }).strict(),
  "task.result": z.object({ jobId: JobIdSchema }).strict(),
  "task.cancel": z.object({ jobId: JobIdSchema }).strict()
} as const;

export type ToolName = keyof typeof ToolArgsSchemas;
export const ToolNameSchema = z.enum(Object.keys(ToolArgsSchemas) as [ToolName, ...ToolName[]]);
export const McpProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
export const CustomToolIdSchema = z
  .string()
  .min(12)
  .max(255)
  .regex(/^mcp\.[a-z0-9][a-z0-9_-]{1,63}\.[a-z0-9][a-z0-9_-]{0,63}\.[a-f0-9]{8}$/);
export const ToolIdSchema = z.union([ToolNameSchema, CustomToolIdSchema]);
export type ToolId = z.infer<typeof ToolIdSchema>;

export function isBuiltinTool(tool: string): tool is ToolName {
  return ToolNameSchema.safeParse(tool).success;
}

export function absolutePathForToolArgs(
  tool: string,
  args: Record<string, unknown>
): string | undefined {
  if (!isBuiltinTool(tool)) return undefined;
  const candidate = tool.startsWith("file.") ? args.path : args.cwd;
  return typeof candidate === "string" && candidate.startsWith("/") ? candidate : undefined;
}

export const ReadOnlyTools: ReadonlySet<ToolName> = new Set([
  "device.list",
  "device.status",
  "device.battery.get",
  "device.network.get",
  "location.get",
  "file.list",
  "file.read",
  "file.search",
  "command.template.list",
  "task.status",
  "task.result"
]);

export const SideEffectTools: ReadonlySet<ToolName> = new Set([
  "notification.show",
  "file.write",
  "file.edit",
  "file.patch",
  "shell.exec",
  "command.template.run",
  "test.run",
  "task.cancel"
]);

export function isSideEffectTool(tool: string): boolean {
  return !isBuiltinTool(tool) || SideEffectTools.has(tool);
}

const InvocationBaseSchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    invocationId: InvocationIdSchema,
    attemptId: AttemptIdSchema,
    accountId: AccountIdSchema,
    actor: z
      .object({
        type: z.enum(["owner", "agent", "service"]),
        id: ActorIdSchema
      })
      .strict(),
    target: z.union([
      z.object({ nodeId: NodeIdSchema }).strict(),
      z
        .object({
          projectId: ProjectIdSchema,
          affinity: z.string().min(1).max(128).optional()
        })
        .strict()
    ]),
    authorization: z
      .object({
        projectId: ProjectIdSchema.optional(),
        rootIds: z.array(RootIdSchema).max(64).default([]),
        grantId: z.string().regex(/^grant_[a-z0-9][a-z0-9_-]{2,127}$/)
      })
      .strict(),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(256).optional(),
    metadata: z
      .object({
        correlationId: z.string().min(1).max(128).optional(),
        sessionId: z.string().min(1).max(128).optional(),
        source: z.enum(["http", "cli", "mcp", "sdk", "skill", "internal"])
      })
      .strict()
  })
  .strict();

const invocationVariants = Object.entries(ToolArgsSchemas).map(([tool, argsSchema]) =>
  InvocationBaseSchema.extend({
    tool: z.literal(tool),
    args: argsSchema
  }).strict()
);
const CustomInvocationSchema = InvocationBaseSchema.extend({
  tool: CustomToolIdSchema,
  args: z.record(z.string(), z.unknown())
}).strict();
const BuiltinInvocationSchema = z.union(
  invocationVariants as unknown as [
    (typeof invocationVariants)[number],
    (typeof invocationVariants)[number],
    ...(typeof invocationVariants)[number][]
  ]
);

export const InvocationSchema = z
  .union([BuiltinInvocationSchema, CustomInvocationSchema])
  .superRefine((invocation, context) => {
    if (Date.parse(invocation.expiresAt) <= Date.parse(invocation.issuedAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "must be after issuedAt" });
    }
    if (isSideEffectTool(invocation.tool) && !invocation.idempotencyKey) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "required for side-effecting tools"
      });
    }
  });

export type Invocation = z.infer<typeof InvocationSchema>;

export const ErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().min(1).max(2000),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type AdcError = z.infer<typeof ErrorSchema>;

export const PolicyDecisionSchema = z
  .object({
    outcome: z.enum(["allow", "deny", "approval_required"]),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
    explanation: z.string().min(1).max(2000),
    evaluatedLayers: z.array(z.enum(["account", "agent", "node", "root", "capability"])),
    profile: z.enum(["read-only", "workspace-write", "approve-required", "unattended"]),
    decisionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  })
  .strict();
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ReceiptSchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    receiptId: ReceiptIdSchema,
    invocationId: InvocationIdSchema,
    attemptId: AttemptIdSchema,
    nodeId: NodeIdSchema,
    tool: ToolIdSchema,
    terminalStatus: z.enum(["succeeded", "failed", "denied", "cancelled", "unknown_outcome"]),
    sideEffect: z.boolean(),
    replayed: z.boolean().default(false),
    idempotencyKeyHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    argsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    policyDecisionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    outputHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    artifactRefs: z.array(z.string().min(1).max(512)).default([])
  })
  .strict();
export type Receipt = z.infer<typeof ReceiptSchema>;

export const ResultSchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    invocationId: InvocationIdSchema,
    attemptId: AttemptIdSchema,
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "denied",
      "approval_required",
      "offline",
      "cancelled",
      "unknown_outcome"
    ]),
    output: z.unknown().optional(),
    error: ErrorSchema.optional(),
    receipt: ReceiptSchema.optional(),
    jobId: JobIdSchema.optional()
  })
  .strict()
  .superRefine((result, context) => {
    const errorStatuses = new Set([
      "failed",
      "denied",
      "approval_required",
      "offline",
      "cancelled",
      "unknown_outcome"
    ]);
    if (errorStatuses.has(result.status) && !result.error) {
      context.addIssue({ code: "custom", path: ["error"], message: "required for error status" });
    }
  });
export type InvocationResult = z.infer<typeof ResultSchema>;

export const JsonObjectSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  try {
    if (JSON.stringify(value).length > 128 * 1024) {
      context.addIssue({ code: "custom", message: "JSON schema exceeds 128 KiB" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "JSON schema must be serializable" });
  }
});
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const ToolCapabilitySchema = z
  .object({
    name: ToolIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    risk: z.enum(["read", "write", "execute"]),
    sandboxProfiles: z
      .array(z.enum(["restricted-process", "full-trust", "container", "native-app"]))
      .min(1),
    availability: z
      .object({
        state: z.enum([
          "available",
          "permission_required",
          "foreground_required",
          "temporarily_unavailable"
        ]),
        reason: z.string().min(1).max(500).optional(),
        observedAt: z.iso.datetime({ offset: true })
      })
      .strict()
      .optional(),
    title: z.string().min(1).max(128).optional(),
    description: z.string().min(1).max(4000).optional(),
    inputSchema: JsonObjectSchema.optional(),
    outputSchema: JsonObjectSchema.optional(),
    provider: z
      .object({
        kind: z.literal("mcp"),
        providerId: McpProviderIdSchema,
        providerName: z.string().min(1).max(128),
        sourceToolName: z.string().min(1).max(256)
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((tool, context) => {
    if (CustomToolIdSchema.safeParse(tool.name).success) {
      if (!tool.provider) {
        context.addIssue({
          code: "custom",
          path: ["provider"],
          message: "required for custom MCP tools"
        });
      }
      if (!tool.inputSchema || tool.inputSchema.type !== "object") {
        context.addIssue({
          code: "custom",
          path: ["inputSchema"],
          message: "custom MCP tools require an object input schema"
        });
      }
      if (tool.risk !== "execute") {
        context.addIssue({
          code: "custom",
          path: ["risk"],
          message: "custom MCP tools default to execute risk"
        });
      }
    }
  });
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const CapabilitySchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_VERSION),
    nodeId: NodeIdSchema,
    tools: z
      .array(ToolCapabilitySchema)
      .max(512)
      .refine(
        (tools) => new Set(tools.map((tool) => tool.name)).size === tools.length,
        "Tool IDs must be unique."
      ),
    roots: z.array(
      z
        .object({
          rootId: RootIdSchema,
          path: AbsolutePathSchema.optional(),
          label: z.string().min(1).max(128),
          writable: z.boolean()
        })
        .strict()
    ),
    platform: NodePlatformSchema,
    accessMode: z.enum(["none", "selected", "home", "full"]).optional(),
    nodeVersion: z.string().min(1).max(64),
    advertisedAt: z.iso.datetime({ offset: true })
  })
  .strict();
export type CapabilityAdvertisement = z.infer<typeof CapabilitySchema>;

export function assertInvocationCurrent(invocation: Invocation, now = new Date()): void {
  if (Date.parse(invocation.expiresAt) <= now.getTime()) {
    throw new ProtocolError(ErrorCodes.EXPIRED, "invocation has expired", false);
  }
}

export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    retryable: boolean,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  toJSON(): AdcError {
    return ErrorSchema.parse({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {})
    });
  }
}

export function createId(
  prefix:
    | "acct"
    | "actor"
    | "node"
    | "proj"
    | "root"
    | "inv"
    | "att"
    | "dsp"
    | "apr"
    | "rcpt"
    | "job"
    | "grant"
): string {
  const timestamp = Date.now().toString(36).padStart(9, "0");
  return `${prefix}_${timestamp}${randomBytes(10).toString("hex")}`;
}
