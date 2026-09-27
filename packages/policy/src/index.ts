import { createHash } from "node:crypto";
import {
  AbsolutePathSchema,
  PolicyDecisionSchema,
  ReadOnlyTools,
  ToolIdSchema,
  ToolNameSchema,
  absolutePathForToolArgs,
  isBuiltinTool,
  isSideEffectTool,
  rootForAbsolutePath,
  type Invocation,
  type PolicyDecision,
  type ToolId,
  type ToolName
} from "@adc/protocol";
import { z } from "zod";

export const PolicyProfileSchema = z.enum([
  "read-only",
  "workspace-write",
  "approve-required",
  "unattended"
]);
export type PolicyProfile = z.infer<typeof PolicyProfileSchema>;

export const ApprovalPolicySchema = z.enum(["never", "writes", "execute", "always"]);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const PolicyContextSchema = z
  .object({
    account: z
      .object({
        allowedTools: z.array(ToolIdSchema),
        deniedTools: z.array(ToolIdSchema).default([]),
        approvalRequiredTools: z.array(ToolIdSchema).default([]),
        unattendedAllowed: z.boolean().default(false)
      })
      .strict(),
    agent: z
      .object({
        profile: PolicyProfileSchema,
        nodeIds: z.array(z.string()),
        rootIds: z.array(z.string()),
        approvalPolicy: ApprovalPolicySchema.optional(),
        allowedTools: z.array(ToolIdSchema)
      })
      .strict(),
    node: z
      .object({
        nodeId: z.string(),
        online: z.boolean(),
        revoked: z.boolean(),
        advertisedTools: z.array(ToolIdSchema),
        disabledTools: z.array(ToolIdSchema).default([]),
        roots: z.array(
          z
            .object({
              rootId: z.string(),
              path: AbsolutePathSchema.optional(),
              writable: z.boolean()
            })
            .strict()
        )
      })
      .strict()
  })
  .strict();
export type PolicyContext = z.infer<typeof PolicyContextSchema>;

const profileTools: Record<PolicyProfile, ReadonlySet<ToolName>> = {
  "read-only": ReadOnlyTools,
  "workspace-write": new Set(ToolNameSchema.options),
  "approve-required": new Set(ToolNameSchema.options),
  unattended: new Set([
    "device.list",
    "device.status",
    "file.list",
    "file.read",
    "file.search",
    "command.template.list",
    "command.template.run",
    "test.run",
    "task.status",
    "task.result",
    "task.cancel"
  ])
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function decision(
  context: PolicyContext,
  outcome: PolicyDecision["outcome"],
  reasonCode: string,
  explanation: string
): PolicyDecision {
  const unsigned = {
    outcome,
    reasonCode,
    explanation,
    evaluatedLayers: ["account", "agent", "node", "root", "capability"] as const,
    profile: context.agent.profile
  };
  return PolicyDecisionSchema.parse({ ...unsigned, decisionHash: sha256(unsigned) });
}

function legacyInvocationRootId(invocation: Invocation): string | undefined {
  if (!isBuiltinTool(invocation.tool)) return undefined;
  const args = invocation.args as Record<string, unknown>;
  return typeof args.rootId === "string" ? args.rootId : undefined;
}

export function evaluatePolicy(rawContext: PolicyContext, invocation: Invocation): PolicyDecision {
  const context = PolicyContextSchema.parse(rawContext);
  const tool = invocation.tool;

  if (context.node.revoked) {
    return decision(context, "deny", "node.revoked", "The target device has been revoked.");
  }
  if (!context.node.online) {
    return decision(context, "deny", "node.offline", "The explicitly selected device is offline.");
  }
  if (!context.agent.nodeIds.includes(context.node.nodeId)) {
    return decision(
      context,
      "deny",
      "agent.node_not_granted",
      "The agent grant does not include the target device."
    );
  }
  if (!context.account.allowedTools.includes(tool) || context.account.deniedTools.includes(tool)) {
    return decision(
      context,
      "deny",
      "account.capability_denied",
      "The account policy denies this capability."
    );
  }
  if (
    !context.agent.allowedTools.includes(tool) ||
    !profileAllowsTool(context.agent.profile, tool)
  ) {
    return decision(
      context,
      "deny",
      "agent.capability_denied",
      "The agent grant or profile denies this capability."
    );
  }
  if (!context.node.advertisedTools.includes(tool) || context.node.disabledTools.includes(tool)) {
    return decision(
      context,
      "deny",
      "node.capability_unavailable",
      "The device does not currently advertise this capability."
    );
  }

  const absolutePath = absolutePathForToolArgs(tool, invocation.args as Record<string, unknown>);
  const matchedRoot = absolutePath
    ? rootForAbsolutePath(absolutePath, context.node.roots)
    : undefined;
  if (absolutePath && !matchedRoot) {
    return decision(
      context,
      "deny",
      "node.root_unavailable",
      "The device does not advertise a root containing the requested absolute path."
    );
  }
  const rootId = legacyInvocationRootId(invocation) ?? matchedRoot?.rootId;
  if (rootId) {
    if (!invocation.authorization.rootIds.includes(rootId)) {
      return decision(
        context,
        "deny",
        "invocation.root_not_authorized",
        "The invocation authorization does not include the requested root."
      );
    }
    if (!context.agent.rootIds.includes(rootId)) {
      return decision(
        context,
        "deny",
        "agent.root_not_granted",
        "The agent grant does not include the requested root."
      );
    }
    const root = matchedRoot ?? context.node.roots.find((candidate) => candidate.rootId === rootId);
    if (!root) {
      return decision(
        context,
        "deny",
        "node.root_unavailable",
        "The device does not advertise the requested root."
      );
    }
    if (isSideEffectTool(tool) && !root.writable) {
      return decision(
        context,
        "deny",
        "root.read_only",
        "The selected root does not allow writes or arbitrary execution."
      );
    }
  }

  if (context.agent.profile === "unattended" && !context.account.unattendedAllowed) {
    return decision(
      context,
      "deny",
      "account.unattended_denied",
      "The account has not enabled unattended execution."
    );
  }

  if (
    context.account.approvalRequiredTools.includes(tool) ||
    requiresApproval(context.agent.approvalPolicy, context.agent.profile, tool)
  ) {
    return decision(
      context,
      "approval_required",
      "approval.required",
      "This capability requires an explicit approval before dispatch."
    );
  }

  return decision(
    context,
    "allow",
    "policy.allowed",
    "All account, agent, device, root and capability checks passed."
  );
}

export function requiresApproval(
  policy: ApprovalPolicy | undefined,
  profile: PolicyProfile,
  tool: ToolId
): boolean {
  if (policy === undefined) return profile === "approve-required" && isSideEffectTool(tool);
  if (policy === "always") return true;
  if (policy === "writes") return isSideEffectTool(tool);
  if (policy === "execute")
    return (
      !isBuiltinTool(tool) || ["shell.exec", "command.template.run", "test.run"].includes(tool)
    );
  return false;
}

function profileAllowsTool(profile: PolicyProfile, tool: ToolId): boolean {
  if (profile === "workspace-write" || profile === "approve-required") return true;
  if (!isBuiltinTool(tool)) return false;
  return profileTools[profile].has(tool);
}
