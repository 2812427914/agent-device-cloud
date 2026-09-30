import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createId, CustomToolIdSchema, ProtocolError, ToolIdSchema } from "@adc/protocol";
import { ApprovalPolicySchema } from "@adc/policy";
import type { AgentGrantRecord, AuditEvent, NodeRecord, Store } from "@adc/db";

const rootId = z.string().regex(/^root_[a-z0-9][a-z0-9_-]{2,127}$/);
const roots = z
  .array(rootId)
  .max(64)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate folders");
export const DEFAULT_NODE_MAX_CONCURRENCY = 6;
export const MAX_NODE_MAX_CONCURRENCY = 32;
export const NodeAccessPolicySchema = z
  .object({
    rootAccess: z.enum(["all", "selected"]),
    rootIds: roots,
    readOnlyRootIds: roots,
    allowExecution: z.boolean(),
    maxConcurrency: z
      .number()
      .int()
      .min(1)
      .max(MAX_NODE_MAX_CONCURRENCY)
      .default(DEFAULT_NODE_MAX_CONCURRENCY)
  })
  .strict();
export function defaultNodeAccessPolicy(): z.infer<typeof NodeAccessPolicySchema> {
  return {
    rootAccess: "all",
    rootIds: [],
    readOnlyRootIds: [],
    allowExecution: true,
    maxConcurrency: DEFAULT_NODE_MAX_CONCURRENCY
  };
}
export function nodeMaxConcurrency(node: NodeRecord): number {
  const value = node.accessPolicy?.maxConcurrency;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_NODE_MAX_CONCURRENCY
    ? value
    : DEFAULT_NODE_MAX_CONCURRENCY;
}
export const GrantSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    projectId: z.string().optional(),
    profile: z.enum(["read-only", "workspace-write", "approve-required", "unattended"]),
    nodeIds: z
      .array(z.string())
      .max(64)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate devices"),
    rootAccess: z.enum(["selected", "all"]),
    rootIds: roots,
    approvalPolicy: ApprovalPolicySchema.optional(),
    allowedTools: z
      .array(ToolIdSchema)
      .min(1)
      .max(256)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate tools")
  })
  .strict();
const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();
const executionTools = new Set(["shell.exec", "command.template.run", "test.run"]);
/** Cloud controls narrow the locally advertised capability; they never expose new paths. */
export function effectiveCapability(node: NodeRecord) {
  const capability = node.capability;
  if (!capability || !node.accessPolicy) return capability;
  const policy = node.accessPolicy;
  return {
    ...capability,
    roots: capability.roots
      .filter((root) => policy.rootAccess === "all" || policy.rootIds.includes(root.rootId))
      .map((root) => ({
        ...root,
        writable: root.writable && !policy.readOnlyRootIds.includes(root.rootId)
      })),
    tools: capability.tools.filter(
      (tool) => policy.allowExecution || (!executionTools.has(tool.name) && tool.risk !== "execute")
    )
  };
}

export async function validateGrantResources(
  store: Store,
  accountId: string,
  body: z.infer<typeof GrantSettingsSchema>,
  previous?: AgentGrantRecord
) {
  if (!body.projectId && !body.nodeIds.length)
    throw new ProtocolError("invalid_request", "Select at least one device.", false);
  if (body.projectId) {
    const project = await store.getProject(body.projectId);
    if (!project || project.accountId !== accountId)
      throw new ProtocolError("not_found", "Project was not found.", false);
    if (body.rootAccess === "all")
      throw new ProtocolError(
        "invalid_request",
        "All-folder access requires a direct device grant.",
        false
      );
  }
  if (body.rootAccess === "all" && body.rootIds.length)
    throw new ProtocolError(
      "invalid_request",
      "All-folder access must not include a fixed folder selection.",
      false
    );
  const nodes = await store.listNodes(accountId);
  const selectedNodes = nodes.filter(
    (node) => body.nodeIds.includes(node.nodeId) && node.status === "active"
  );
  const availableRoots = body.projectId
    ? await store.listRoots(body.projectId)
    : nodes.flatMap((node) =>
        (node.capability?.roots ?? []).map((root) => ({ ...root, nodeId: node.nodeId }))
      );
  // Retain previously authorized unavailable resources so renaming never broadens or erases scope.
  const sameScope = previous?.projectId === body.projectId;
  if (
    body.nodeIds.some(
      (id) =>
        !nodes.some((node) => node.nodeId === id && node.status === "active") &&
        !previous?.nodeIds.includes(id)
    ) ||
    body.rootIds.some(
      (id) =>
        !availableRoots.some((root) => root.rootId === id && body.nodeIds.includes(root.nodeId)) &&
        !(
          sameScope &&
          previous?.rootIds.includes(id) &&
          body.nodeIds.every((nodeId) => previous.nodeIds.includes(nodeId))
        )
    )
  )
    throw new ProtocolError(
      "denied",
      "Grant resources must belong to this account and the selected devices.",
      false
    );
  const availableTools = new Set(
    selectedNodes.flatMap((node) => effectiveCapability(node)?.tools.map((tool) => tool.name) ?? [])
  );
  const sameNodes =
    previous?.nodeIds.length === body.nodeIds.length &&
    body.nodeIds.every((nodeId) => previous.nodeIds.includes(nodeId));
  if (
    body.allowedTools.some(
      (tool) =>
        CustomToolIdSchema.safeParse(tool).success &&
        !availableTools.has(tool) &&
        !(sameNodes && previous?.allowedTools.includes(tool))
    )
  )
    throw new ProtocolError(
      "denied",
      "Custom tools must be registered by one of the selected devices.",
      false
    );
}

export function registerResourceManagement(
  app: FastifyInstance,
  options: {
    store: Store;
    requireOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    accountOf: (request: FastifyRequest) => string;
    now: () => Date;
    disconnectNode?: (nodeId: string) => void;
    wakeNode?: (nodeId: string) => void;
  }
) {
  const { store, requireOwner, accountOf, now } = options;
  const audit = (
    request: FastifyRequest,
    type: string,
    payload: Record<string, unknown>
  ): AuditEvent => ({
    eventId: createId("dsp"),
    accountId: accountOf(request),
    type,
    payload,
    createdAt: now().toISOString()
  });
  const ownedNode = async (request: FastifyRequest) => {
    const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
    const node = await store.getNode(nodeId);
    if (!node || node.accountId !== accountOf(request) || node.deletedAt)
      throw new ProtocolError("not_found", "Device was not found.", false);
    return node;
  };
  const ownedGrant = async (request: FastifyRequest) => {
    const { grantId } = z.object({ grantId: z.string() }).parse(request.params);
    const grant = await store.getGrant(grantId);
    if (!grant || grant.accountId !== accountOf(request) || grant.deletedAt)
      throw new ProtocolError("not_found", "Agent authorization was not found.", false);
    return grant;
  };
  app.patch("/api/v1/nodes/:nodeId", { preHandler: requireOwner }, async (request) => {
    const node = await ownedNode(request);
    const body = z
      .object({
        revision: z.number().int().min(1),
        label: z.string().trim().min(1).max(128),
        description: z.string().trim().max(500).optional(),
        accessPolicy: NodeAccessPolicySchema
      })
      .strict()
      .parse(request.body);
    const policy = body.accessPolicy;
    if (
      (policy.rootAccess === "all" && policy.rootIds.length) ||
      [...policy.rootIds, ...policy.readOnlyRootIds].some(
        (id) =>
          !node.capability?.roots.some((root) => root.rootId === id) &&
          !node.accessPolicy?.rootIds.includes(id) &&
          !node.accessPolicy?.readOnlyRootIds.includes(id)
      )
    )
      throw new ProtocolError(
        "invalid_request",
        "Choose folders already exposed by this device.",
        false
      );
    const updated = await store.updateNode(
      node.accountId,
      node.nodeId,
      {
        label: body.label,
        ...(body.description === undefined ? {} : { description: body.description }),
        accessPolicy: policy
      },
      body.revision,
      audit(request, "node.updated", {
        nodeId: node.nodeId,
        label: body.label,
        ...(body.description === undefined ? {} : { description: body.description }),
        accessPolicy: policy,
        before: {
          label: node.label,
          description: node.description ?? null,
          accessPolicy: node.accessPolicy ?? null
        }
      })
    );
    options.wakeNode?.(node.nodeId);
    return updated;
  });
  app.delete("/api/v1/nodes/:nodeId", { preHandler: requireOwner }, async (request) => {
    const node = await ownedNode(request);
    const { revision } = revisionSchema.parse(request.body);
    await store.deleteNode(
      node.accountId,
      node.nodeId,
      revision,
      audit(request, "node.deleted", { nodeId: node.nodeId, label: node.label })
    );
    options.disconnectNode?.(node.nodeId);
    return { deleted: true };
  });
  app.patch("/api/v1/grants/:grantId", { preHandler: requireOwner }, async (request) => {
    const previous = await ownedGrant(request);
    const { revision, ...body } = GrantSettingsSchema.extend({
      revision: z.number().int().min(1)
    }).parse(request.body);
    await validateGrantResources(store, previous.accountId, body, previous);
    const { projectId, approvalPolicy, ...settings } = body;
    const updated: AgentGrantRecord = {
      grantId: previous.grantId,
      actorId: previous.actorId,
      accountId: previous.accountId,
      createdAt: previous.createdAt,
      ...settings,
      ...(projectId ? { projectId } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {})
    };
    return store.updateGrant(
      updated,
      revision,
      audit(request, "grant.updated", {
        grantId: previous.grantId,
        before: {
          name: previous.name,
          projectId: previous.projectId,
          nodeIds: previous.nodeIds,
          rootIds: previous.rootIds,
          rootAccess: previous.rootAccess,
          profile: previous.profile,
          approvalPolicy: previous.approvalPolicy,
          allowedTools: previous.allowedTools
        },
        after: body
      })
    );
  });
  app.delete("/api/v1/grants/:grantId", { preHandler: requireOwner }, async (request) => {
    const grant = await ownedGrant(request);
    const { revision } = revisionSchema.parse(request.body);
    await store.deleteGrant(
      grant.accountId,
      grant.grantId,
      revision,
      audit(request, "grant.deleted", { grantId: grant.grantId, name: grant.name })
    );
    return { deleted: true };
  });
}
