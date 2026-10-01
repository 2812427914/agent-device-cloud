import { createHash, createPublicKey, randomBytes, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { z } from "zod";
import { verifyNodeRequest } from "@adc/client/node";
import { registerCors } from "./cors.ts";
import {
  type AgentGrantRecord,
  type ApprovalRecord,
  type AuditEvent,
  type DispatchRecord,
  type NodeRecord,
  type PageCursor,
  type Store
} from "@adc/db";
import { evaluatePolicy, sha256 } from "@adc/policy";
import { createMcpServer } from "@adc/mcp-adapter";
import {
  CapabilitySchema,
  ErrorCodes,
  InvocationIdSchema,
  InvocationSchema,
  NodePlatformSchema,
  ProtocolError,
  ResultSchema,
  ToolIdSchema,
  ToolNameSchema,
  absolutePathForToolArgs,
  assertInvocationCurrent,
  createId,
  isBuiltinTool,
  type AdcError,
  type Invocation,
  type InvocationResult,
  type PolicyDecision
} from "@adc/protocol";
import {
  assertSameOrigin,
  grantContext,
  registerAuthenticationRoutes,
  type AccessService,
  type Principal
} from "./access.ts";
import { registerAccountRoutes } from "./account-routes.ts";
import {
  defaultNodeAccessPolicy,
  effectiveCapability,
  GrantSettingsSchema,
  MAX_NODE_MAX_CONCURRENCY,
  nodeMaxConcurrency,
  registerResourceManagement,
  validateGrantResources
} from "./resource-management.ts";
import {
  distributionInfo,
  registerDistributionRoutes,
  type NodeDistribution
} from "./distribution.ts";
import { NodeWakeHub } from "./node-wake.ts";
import { PublicSite, type HostedAnalyticsOptions } from "./public-site.ts";

export interface ControlPlaneOptions {
  store: Store;
  access: AccessService;
  logger?: boolean;
  now?: () => Date;
  presenceTtlMs?: number;
  leaseMs?: number;
  consoleDirectory?: string;
  nodeDistribution?: NodeDistribution;
  trustProxy?: string[];
  /** Opt-in cross-origin origins for API consumers. See registerCors(). */
  corsOrigins?: string[] | "*";
  analytics?: HostedAnalyticsOptions;
}

function invocationPath(invocation: Invocation, node: NodeRecord | undefined): string | undefined {
  if (!isBuiltinTool(invocation.tool)) return undefined;
  const args = invocation.args as Record<string, unknown>;
  const absolute = absolutePathForToolArgs(invocation.tool, args);
  if (absolute) return absolute;
  const rootId = typeof args.rootId === "string" ? args.rootId : undefined;
  const rootPath = node?.capability?.roots.find((root) => root.rootId === rootId)?.path;
  if (!rootPath) return undefined;
  const relativePath = invocation.tool.startsWith("file.") ? args.path : args.cwd;
  if (typeof relativePath !== "string" || relativePath === "") return rootPath;
  return rootPath === "/" ? `/${relativePath}` : `${rootPath}/${relativePath}`;
}

const PageCursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    itemId: z.string().min(1).max(160)
  })
  .strict();
const AuditCategorySchema = z.enum([
  "dispatch",
  "approval",
  "task",
  "node",
  "grant",
  "credential",
  "oauth"
]);

function encodePageCursor(cursor: PageCursor | undefined): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null;
}

function decodePageCursor(value: string | undefined): PageCursor | undefined {
  if (!value) return;
  try {
    return PageCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new ProtocolError(ErrorCodes.INVALID_REQUEST, "pagination cursor is invalid", false);
  }
}

async function auditView(
  store: Store,
  accountId: string,
  events: AuditEvent[]
): Promise<AuditEvent[]> {
  const invocationIds = [
    ...new Set(
      events.map((event) => event.invocationId).filter((id): id is string => typeof id === "string")
    )
  ];
  const dispatches = await store.listDispatchesByInvocationIds(accountId, invocationIds);
  const dispatchByInvocation = new Map(
    dispatches.map((dispatch) => [dispatch.invocation.invocationId, dispatch])
  );
  const nodes = new Map(
    (
      await store.listNodesByIds(accountId, [
        ...new Set(dispatches.map((dispatch) => dispatch.nodeId))
      ])
    ).map((node) => [node.nodeId, node])
  );
  return events.map((event) => {
    const dispatch = event.invocationId ? dispatchByInvocation.get(event.invocationId) : undefined;
    if (!dispatch) return event;
    const path = invocationPath(dispatch.invocation, nodes.get(dispatch.nodeId));
    return {
      ...event,
      payload: {
        ...event.payload,
        nodeId: dispatch.nodeId,
        tool: dispatch.invocation.tool,
        ...(path ? { path } : {})
      }
    };
  });
}

async function approvalView(
  store: Store,
  accountId: string,
  approvals: ApprovalRecord[]
): Promise<Array<ApprovalRecord & { path?: string }>> {
  const nodes = new Map(
    (
      await store.listNodesByIds(accountId, [
        ...new Set(approvals.map((approval) => approval.nodeId))
      ])
    ).map((node) => [node.nodeId, node])
  );
  return approvals.map((approval) => {
    const path = invocationPath(approval.invocation, nodes.get(approval.nodeId));
    return { ...approval, ...(path ? { path } : {}) };
  });
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function apiError(
  reply: FastifyReply,
  statusCode: number,
  code: AdcError["code"],
  message: string,
  retryable = false,
  details?: Record<string, unknown>
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      retryable,
      ...(details ? { details } : {})
    }
  });
}

function jobIdForDispatch(dispatchId: string): string {
  return `job_${dispatchId.slice("dsp_".length)}`;
}

function dispatchIdForJob(jobId: string): string | undefined {
  return /^job_[a-z0-9][a-z0-9_-]{2,127}$/.test(jobId)
    ? `dsp_${jobId.slice("job_".length)}`
    : undefined;
}

function queuedResult(dispatch: DispatchRecord): InvocationResult {
  if (dispatch.status === "cancelled")
    return ResultSchema.parse({
      schemaVersion: "0.1",
      invocationId: dispatch.invocation.invocationId,
      attemptId: dispatch.invocation.attemptId,
      status: "cancelled",
      error: {
        code: ErrorCodes.CANCELLED,
        message: "Task was cancelled before execution.",
        retryable: false
      },
      jobId: jobIdForDispatch(dispatch.dispatchId)
    });
  return ResultSchema.parse({
    schemaVersion: "0.1",
    invocationId: dispatch.invocation.invocationId,
    attemptId: dispatch.invocation.attemptId,
    status:
      dispatch.status === "running" ||
      dispatch.status === "leased" ||
      dispatch.status === "cancel_requested"
        ? "running"
        : "queued",
    jobId: jobIdForDispatch(dispatch.dispatchId)
  });
}

function domainResult(
  invocation: Invocation,
  status: "denied" | "approval_required" | "offline",
  error: AdcError
): InvocationResult {
  return ResultSchema.parse({
    schemaVersion: "0.1",
    invocationId: invocation.invocationId,
    attemptId: invocation.attemptId,
    status,
    error
  });
}

export async function createControlPlane(options: ControlPlaneOptions): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date());
  const presenceTtlMs = options.presenceTtlMs ?? 45_000;
  const leaseMs = options.leaseMs ?? 30_000;
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 36 * 1024 * 1024,
    trustProxy: options.trustProxy ?? false
  });
  const analyticsOrigin = options.analytics
    ? new URL(options.analytics.scriptUrl).origin
    : undefined;
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 1024 },
    preClose(done) {
      for (const socket of this.websocketServer.clients) socket.terminate();
      this.websocketServer.close(done);
    }
  });
  if (options.corsOrigins) registerCors(app, { origins: options.corsOrigins });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "DENY");
    if (
      request.url.startsWith("/api/") ||
      request.url.startsWith("/mcp") ||
      request.url === "/metrics"
    ) {
      reply.header("cache-control", "no-store");
    }
    reply.header(
      "content-security-policy",
      `default-src 'self'; script-src 'self'${analyticsOrigin ? ` ${analyticsOrigin}` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${analyticsOrigin ? ` ${analyticsOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
    );
    return payload;
  });
  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics, prefix: "adc_" });
  const pairingCounter = new Counter({
    name: "adc_pairing_total",
    help: "Device pairing outcomes.",
    labelNames: ["outcome"],
    registers: [metrics]
  });
  const pollCounter = new Counter({
    name: "adc_node_poll_total",
    help: "Authenticated device polls.",
    labelNames: ["outcome"],
    registers: [metrics]
  });
  const invocationCounter = new Counter({
    name: "adc_invocation_total",
    help: "Invocation policy and terminal outcomes.",
    labelNames: ["outcome", "tool"],
    registers: [metrics]
  });
  const wakeConnectionGauge = new Gauge({
    name: "adc_node_wake_connections",
    help: "Authenticated Node WebSocket wake connections.",
    registers: [metrics]
  });
  const wakeCounter = new Counter({
    name: "adc_node_wake_total",
    help: "Node wake delivery attempts.",
    labelNames: ["outcome"],
    registers: [metrics]
  });
  const wakeHub = new NodeWakeHub({
    now,
    onConnectionCount: (count) => wakeConnectionGauge.set(count),
    onError: (error) => requestLogError(app, error),
    touchPresence: (nodeIds) => options.store.touchNodePresences(nodeIds, now())
  });
  const wakeNode = (nodeId: string) => {
    wakeCounter.inc({ outcome: wakeHub.wake(nodeId) ? "attempted" : "offline" });
  };
  const countInvocation = (outcome: string, tool: string) =>
    invocationCounter.inc({ outcome, tool: isBuiltinTool(tool) ? tool : "mcp.custom" });

  await options.store.migrate();
  if (options.access.authentication) {
    await options.access.authentication.migrate();
    registerAuthenticationRoutes(app, options.access);
  }
  const principals = new WeakMap<FastifyRequest, Principal>();
  const nodeAccounts = new WeakMap<FastifyRequest, string>();
  const nodeWakeGenerations = new WeakMap<FastifyRequest, number>();
  const accountOf = (request: FastifyRequest) => principals.get(request)!.accountId;

  async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
    const principal = await options.access.authenticate(request);
    if (!principal) {
      reply.header(
        "www-authenticate",
        `Bearer resource_metadata="${options.access.origin}/.well-known/oauth-protected-resource/mcp"`
      );
      return apiError(reply, 401, ErrorCodes.DENIED, "Sign in or supply a valid Agent credential.");
    }
    if (principal.kind === "session") assertSameOrigin(request, options.access.origin);
    principals.set(request, principal);
  }

  async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
    await requireAuthenticated(request, reply);
    const principal = principals.get(request);
    if (reply.sent || !principal) return;
    if (principal.kind !== "session" && principal.kind !== "pat") {
      return apiError(reply, 403, ErrorCodes.DENIED, "Account management requires a user session.");
    }
    if (
      principal.kind === "pat" &&
      principal.readOnly &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method)
    ) {
      return apiError(reply, 403, ErrorCodes.DENIED, "This personal access token is read-only.");
    }
  }

  async function dispatchAuthorized(
    dispatch: { invocation: Invocation; nodeId: string; policyDecision: PolicyDecision },
    approving = false
  ): Promise<boolean> {
    const { invocation } = dispatch;
    // Node rejects expired new work and reconciles already durable receipts.
    // Expiry must not replace a completed side effect with "cancelled".
    const grant = await options.store.getGrant(invocation.authorization.grantId);
    const node = await options.store.getNode(dispatch.nodeId);
    if (
      !grant ||
      grant.revokedAt ||
      grant.accountId !== invocation.accountId ||
      grant.actorId !== invocation.actor.id ||
      !node ||
      node.accountId !== invocation.accountId ||
      (grant.projectId && grant.projectId !== invocation.authorization.projectId)
    )
      return false;
    const decision = await policyFor(invocation, grant, node);
    return (
      decision.outcome === "allow" ||
      (decision.outcome === "approval_required" &&
        (approving || dispatch.policyDecision.reasonCode === "approval.granted"))
    );
  }

  async function policyFor(
    invocation: Invocation,
    grant: AgentGrantRecord,
    node: NonNullable<Awaited<ReturnType<Store["getNode"]>>>
  ): Promise<PolicyDecision> {
    const capability = effectiveCapability(node);
    const roots = grant.projectId
      ? await options.store.listRoots(grant.projectId)
      : (capability?.roots ?? []).map((root) => ({ ...root, nodeId: node.nodeId }));
    return evaluatePolicy(
      {
        account: {
          allowedTools: [
            ...new Set([
              ...ToolNameSchema.options,
              ...(capability?.tools.map((tool) => tool.name) ?? [])
            ])
          ],
          deniedTools: [],
          approvalRequiredTools: [],
          unattendedAllowed: grant.profile === "unattended"
        },
        agent: {
          profile: grant.profile,
          nodeIds: grant.nodeIds,
          rootIds:
            grant.rootAccess === "all"
              ? (capability?.roots.map((root) => root.rootId) ?? [])
              : grant.rootIds,
          ...(grant.approvalPolicy ? { approvalPolicy: grant.approvalPolicy } : {}),
          allowedTools: grant.allowedTools
        },
        node: {
          nodeId: node.nodeId,
          revoked: node.status === "revoked",
          online:
            node.status === "active" &&
            !!node.lastSeenAt &&
            now().getTime() - Date.parse(node.lastSeenAt) <= presenceTtlMs,
          advertisedTools: capability?.tools.map((tool) => tool.name) ?? [],
          disabledTools: [],
          roots: roots
            .filter(
              (root) =>
                root.nodeId === node.nodeId &&
                capability?.roots.some((entry) => entry.rootId === root.rootId)
            )
            .map((root) => {
              const advertised = capability?.roots.find((entry) => entry.rootId === root.rootId);
              return {
                rootId: root.rootId,
                ...(advertised?.path ? { path: advertised.path } : {}),
                writable: root.writable && !!advertised?.writable
              };
            })
        }
      },
      invocation
    );
  }

  async function requireNode(request: FastifyRequest, reply: FastifyReply) {
    const nodeId = request.headers["x-adc-node-id"];
    const timestamp = request.headers["x-adc-timestamp"];
    const nonce = request.headers["x-adc-nonce"];
    const signature = request.headers["x-adc-signature"];
    if (
      typeof nodeId !== "string" ||
      typeof timestamp !== "string" ||
      typeof nonce !== "string" ||
      typeof signature !== "string"
    ) {
      return apiError(reply, 401, ErrorCodes.DENIED, "device proof is required");
    }
    if ((request.params as any)?.nodeId !== nodeId) {
      return apiError(reply, 403, ErrorCodes.DENIED, "device identity does not match route");
    }
    const requestTime = Date.parse(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(now().getTime() - requestTime) > 5 * 60_000) {
      return apiError(reply, 401, ErrorCodes.EXPIRED, "device proof timestamp is stale");
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
      return apiError(reply, 401, ErrorCodes.INVALID_REQUEST, "invalid device proof nonce");
    }
    const path = request.url.split("?")[0]!;
    const wakeGeneration = path.endsWith("/events") ? wakeHub.generation(nodeId) : undefined;
    const node = await options.store.getNode(nodeId);
    if (!node || node.status !== "active") {
      return apiError(reply, 401, ErrorCodes.DENIED, "device is unknown or revoked");
    }
    if (
      !verifyNodeRequest(node.publicKey, signature, {
        method: request.method,
        path,
        timestamp,
        nonce,
        body: request.body
      })
    ) {
      return apiError(reply, 401, ErrorCodes.DENIED, "invalid device proof");
    }
    const fresh = await options.store.consumeNodeNonce(
      nodeId,
      nonce,
      new Date(requestTime + 5 * 60_000)
    );
    if (!fresh) {
      return apiError(reply, 409, ErrorCodes.CONFLICT, "device proof was already used");
    }
    nodeAccounts.set(request, node.accountId);
    if (wakeGeneration !== undefined) nodeWakeGenerations.set(request, wakeGeneration);
    if (
      node.capability &&
      !wakeHub.has(nodeId) &&
      !path.endsWith("/poll") &&
      !path.endsWith("/events")
    ) {
      await options.store.touchNodePresences([nodeId], now());
    }
  }

  app.route({
    method: "GET",
    url: "/api/v1/nodes/:nodeId/events",
    preValidation: requireNode,
    handler: async (_request, reply) =>
      reply
        .code(426)
        .header("upgrade", "websocket")
        .send({ error: { code: ErrorCodes.INVALID_REQUEST, message: "WebSocket required." } }),
    wsHandler: (socket, request) => {
      const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
      wakeHub.connect(nodeId, socket, nodeWakeGenerations.get(request));
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProtocolError) {
      const statusCode =
        error.code === ErrorCodes.NOT_FOUND
          ? 404
          : error.code === ErrorCodes.CONFLICT
            ? 409
            : error.code === ErrorCodes.DENIED
              ? 403
              : 400;
      return apiError(reply, statusCode, error.code, error.message, error.retryable, error.details);
    }
    if (error instanceof z.ZodError) {
      return apiError(reply, 400, ErrorCodes.INVALID_REQUEST, "request validation failed", false, {
        issues: error.issues
      });
    }
    requestLogError(app, error);
    return apiError(reply, 500, ErrorCodes.INTERNAL, "internal control plane error", true);
  });

  app.get("/health", async () => {
    if (options.access.identity) await options.access.identity.pool.query("SELECT 1");
    return { ok: true, schemaVersion: "0.1" };
  });
  registerResourceManagement(app, {
    store: options.store,
    requireOwner,
    accountOf,
    now,
    disconnectNode: (nodeId) => wakeHub.disconnect(nodeId, "device removed"),
    wakeNode
  });
  registerAccountRoutes(app, {
    access: options.access,
    store: options.store,
    requireSession: requireOwner,
    requireAuthenticated,
    principal: (request) => principals.get(request)!
  });
  app.get("/api/v1/overview", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const timestamp = now();
    const [resources, activeConnections, activity] = await Promise.all([
      options.store.getAccountResourceSummary(
        accountId,
        new Date(timestamp.getTime() - presenceTtlMs).toISOString(),
        timestamp.toISOString()
      ),
      options.access.identity?.countActiveConnections(accountId, timestamp.toISOString()) ??
        Promise.resolve(0),
      options.store.listAuditPage(accountId, { limit: 5 })
    ]);
    return {
      counts: {
        connectedDevices: resources.activeNodes,
        onlineNow: resources.onlineNodes,
        activeAgents: resources.activeGrants,
        pendingApprovals: resources.pendingApprovals,
        clientConnections: activeConnections
      },
      recentActivity: await auditView(options.store, accountId, activity.events)
    };
  });
  app.get("/metrics", { preHandler: requireOwner }, async (_request, reply) => {
    return reply.type(metrics.contentType).send(await metrics.metrics());
  });

  app.post("/api/v1/pairing-codes", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const body = z
      .object({ ttlSeconds: z.number().int().min(60).max(3600).default(600) })
      .strict()
      .parse(request.body);
    const code = randomBytes(9).toString("base64url");
    const expiresAt = new Date(now().getTime() + body.ttlSeconds * 1000).toISOString();
    await options.store.putPairingCode({
      codeHash: hash(code),
      accountId,
      expiresAt
    });
    return { code, expiresAt };
  });

  app.post("/api/v1/nodes/pair", async (request, reply) => {
    if (
      options.access.identity &&
      !(await options.access.identity.takeRateLimit(`pair:${request.ip}`, 20, 60))
    ) {
      return apiError(reply, 429, ErrorCodes.DENIED, "Too many pairing attempts.", true);
    }
    const body = z
      .object({
        code: z.string().min(8).max(128),
        label: z.string().min(1).max(128),
        platform: NodePlatformSchema,
        publicKey: z.string().min(64).max(8192)
      })
      .strict()
      .parse(request.body);
    const publicKey = createPublicKey(body.publicKey);
    if (
      publicKey.asymmetricKeyType !== "ed25519" &&
      !(
        publicKey.asymmetricKeyType === "ec" &&
        publicKey.asymmetricKeyDetails?.namedCurve === "prime256v1"
      )
    ) {
      return apiError(
        reply,
        400,
        ErrorCodes.INVALID_REQUEST,
        "device key must be Ed25519 or P-256"
      );
    }
    const paired = await options.store.pairNode({
      codeHash: hash(body.code),
      now: now(),
      node: {
        nodeId: createId("node"),
        label: body.label,
        publicKey: body.publicKey,
        platform: body.platform,
        status: "active",
        accessPolicy: defaultNodeAccessPolicy(),
        createdAt: now().toISOString()
      }
    });
    if (!paired) {
      pairingCounter.inc({ outcome: "denied" });
      return apiError(reply, 400, ErrorCodes.DENIED, "pairing code is invalid, expired or used");
    }
    for (const nodeId of paired.replacedNodeIds) {
      wakeHub.disconnect(nodeId, "device replaced");
    }
    pairingCounter.inc({ outcome: "succeeded" });
    return { nodeId: paired.node.nodeId, accountId: paired.node.accountId };
  });

  app.get("/api/v1/nodes", { preHandler: requireOwner }, async (request) => ({
    nodes: (await options.store.listNodes(accountOf(request))).map((node) => ({
      ...node,
      accessPolicy: {
        ...defaultNodeAccessPolicy(),
        ...node.accessPolicy,
        maxConcurrency: nodeMaxConcurrency(node)
      },
      effectiveCapability: effectiveCapability(node),
      online:
        node.status === "active" &&
        !!node.lastSeenAt &&
        now().getTime() - Date.parse(node.lastSeenAt) <= presenceTtlMs
    }))
  }));

  app.post("/api/v1/nodes/:nodeId/revoke", { preHandler: requireOwner }, async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
    const node = await options.store.getNode(nodeId);
    if (!node || node.accountId !== accountOf(request) || node.deletedAt) {
      return apiError(reply, 404, ErrorCodes.NOT_FOUND, "device was not found");
    }
    if (!(await options.store.revokeNode(nodeId, now()))) {
      return apiError(reply, 404, ErrorCodes.NOT_FOUND, "device was not found");
    }
    wakeHub.disconnect(nodeId, "device revoked");
    await options.store.putAudit({
      eventId: createId("dsp"),
      accountId: node.accountId,
      type: "node.revoked",
      payload: { nodeId, label: node.label },
      createdAt: now().toISOString()
    });
    return { revoked: true, nodeId };
  });

  app.post(
    "/api/v1/nodes/:nodeId/rotate-key",
    { preHandler: requireNode },
    async (request, reply) => {
      const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
      const { publicKey } = z
        .object({ publicKey: z.string().min(64).max(8192) })
        .strict()
        .parse(request.body);
      const key = createPublicKey(publicKey);
      if (
        key.asymmetricKeyType !== "ed25519" &&
        !(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1")
      ) {
        return apiError(
          reply,
          400,
          ErrorCodes.INVALID_REQUEST,
          "device key must be Ed25519 or P-256"
        );
      }
      if (!(await options.store.rotateNodeKey(nodeId, publicKey, now()))) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "device was not found");
      }
      wakeHub.disconnect(nodeId, "device key rotated");
      await options.store.putAudit({
        eventId: createId("dsp"),
        accountId: nodeAccounts.get(request)!,
        type: "node.key_rotated",
        payload: { nodeId },
        createdAt: now().toISOString()
      });
      return { rotated: true, nodeId };
    }
  );

  app.post("/api/v1/projects", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const body = z
      .object({
        projectId: z
          .string()
          .regex(/^proj_[a-z0-9][a-z0-9_-]{2,127}$/)
          .default(() => createId("proj")),
        label: z.string().min(1).max(128)
      })
      .strict()
      .parse(request.body);
    const project = {
      ...body,
      accountId,
      createdAt: now().toISOString()
    };
    await options.store.putProject(project);
    return project;
  });

  app.get("/api/v1/projects", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const { include } = z
      .object({ include: z.literal("roots").optional() })
      .strict()
      .parse(request.query);
    const projects = await options.store.listProjects(accountId);
    if (include !== "roots") return { projects };
    const [roots, listedNodes] = await Promise.all([
      options.store.listRootsForAccount(accountId),
      options.store.listNodes(accountId)
    ]);
    const nodes = new Map(listedNodes.map((node) => [node.nodeId, node]));
    return {
      projects,
      roots: roots.map((root) => {
        const advertised = nodes
          .get(root.nodeId)
          ?.capability?.roots.find((candidate) => candidate.rootId === root.rootId);
        return { ...root, ...(advertised?.path ? { path: advertised.path } : {}) };
      })
    };
  });

  app.get(
    "/api/v1/projects/:projectId/roots",
    { preHandler: requireOwner },
    async (request, reply) => {
      const accountId = accountOf(request);
      const { projectId } = z.object({ projectId: z.string() }).parse(request.params);
      const project = await options.store.getProject(projectId);
      if (!project || project.accountId !== accountId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "project was not found");
      }
      const nodes = new Map(
        (await options.store.listNodes(accountId)).map((node) => [node.nodeId, node])
      );
      return {
        roots: (await options.store.listRoots(projectId)).map((root) => {
          const advertised = nodes
            .get(root.nodeId)
            ?.capability?.roots.find((candidate) => candidate.rootId === root.rootId);
          return { ...root, ...(advertised?.path ? { path: advertised.path } : {}) };
        })
      };
    }
  );

  app.post(
    "/api/v1/projects/:projectId/roots",
    { preHandler: requireOwner },
    async (request, reply) => {
      const accountId = accountOf(request);
      const { projectId } = z.object({ projectId: z.string() }).parse(request.params);
      const project = await options.store.getProject(projectId);
      if (!project || project.accountId !== accountId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "project was not found");
      }
      const body = z
        .object({
          rootId: z.string().regex(/^root_[a-z0-9][a-z0-9_-]{2,127}$/),
          nodeId: z.string().regex(/^node_[a-z0-9][a-z0-9_-]{2,127}$/),
          label: z.string().min(1).max(128),
          writable: z.boolean()
        })
        .strict()
        .parse(request.body);
      const node = await options.store.getNode(body.nodeId);
      if (!node || node.accountId !== accountId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "device was not found");
      }
      const advertisedRoot = node.capability?.roots.find((root) => root.rootId === body.rootId);
      if (!advertisedRoot || (body.writable && !advertisedRoot.writable)) {
        return apiError(
          reply,
          400,
          ErrorCodes.DENIED,
          "Root must be advertised by the device with compatible access."
        );
      }
      const root = { ...body, projectId, createdAt: now().toISOString() };
      await options.store.putRoot(root);
      return { ...root, ...(advertisedRoot.path ? { path: advertisedRoot.path } : {}) };
    }
  );

  app.post("/api/v1/grants", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const body = GrantSettingsSchema.extend({
      grantId: z
        .string()
        .regex(/^grant_[a-z0-9][a-z0-9_-]{2,127}$/)
        .default(() => createId("grant")),
      actorId: z
        .string()
        .regex(/^actor_[a-z0-9][a-z0-9_-]{2,127}$/)
        .default(() => createId("actor")),
      name: z.string().min(1).max(128).default("Agent"),
      profile: z
        .enum(["read-only", "workspace-write", "approve-required", "unattended"])
        .default("workspace-write"),
      rootAccess: z.enum(["selected", "all"]).default("selected"),
      rootIds: z.array(z.string()).max(64).default([])
    }).parse(request.body);
    await validateGrantResources(options.store, accountId, body);
    const { projectId, approvalPolicy, ...fields } = body;
    const grant: AgentGrantRecord = {
      ...fields,
      ...(projectId ? { projectId } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
      accountId,
      revision: 1,
      createdAt: now().toISOString()
    };
    await options.store.putGrant(grant, true);
    await options.store.putAudit({
      eventId: createId("dsp"),
      accountId,
      type: "grant.saved",
      payload: {
        grantId: grant.grantId,
        nodeIds: grant.nodeIds,
        rootAccess: grant.rootAccess,
        rootIds: grant.rootIds,
        approvalPolicy: grant.approvalPolicy ?? "legacy",
        allowedTools: grant.allowedTools
      },
      createdAt: now().toISOString()
    });
    return grant;
  });

  app.post("/api/v1/nodes/:nodeId/poll", { preHandler: requireNode }, async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
    const body = z
      .object({
        capability: CapabilitySchema,
        activeTaskCount: z.number().int().min(0).max(MAX_NODE_MAX_CONCURRENCY).default(0),
        claim: z.boolean().default(true)
      })
      .strict()
      .parse(request.body);
    if (body.capability.nodeId !== nodeId) {
      return apiError(reply, 400, ErrorCodes.INVALID_REQUEST, "capability nodeId mismatch");
    }
    if (!(await options.store.updateNodePresence(nodeId, body.capability, now()))) {
      pollCounter.inc({ outcome: "denied" });
      return apiError(reply, 401, ErrorCodes.DENIED, "device is revoked");
    }
    const node = await options.store.getNode(nodeId);
    const maxConcurrency = node
      ? nodeMaxConcurrency(node)
      : defaultNodeAccessPolicy().maxConcurrency;
    let dispatch =
      body.claim && body.activeTaskCount < maxConcurrency
        ? await options.store.claim(nodeId, now(), leaseMs)
        : undefined;
    // Re-evaluate queued work after policy changes. A bounded loop avoids one
    // revoked grant indefinitely blocking unrelated work on the same device.
    for (let checked = 0; dispatch && !(await dispatchAuthorized(dispatch)); checked++) {
      const cancelled = await options.store.requestCancel(dispatch.dispatchId, now());
      if (cancelled?.status === "cancel_requested") {
        dispatch = cancelled;
        break;
      }
      if (checked >= 19) {
        dispatch = undefined;
        break;
      }
      dispatch = await options.store.claim(nodeId, now(), leaseMs);
    }
    pollCounter.inc({ outcome: dispatch ? "dispatched" : "idle" });
    return { dispatch: dispatch ?? null, maxConcurrency };
  });

  app.post("/api/v1/nodes/:nodeId/ack", { preHandler: requireNode }, async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
    const body = z
      .object({ dispatchId: z.string(), leaseToken: z.string() })
      .strict()
      .parse(request.body);
    const current = await options.store.getDispatchById(body.dispatchId);
    if (!current || current.nodeId !== nodeId) {
      return apiError(
        reply,
        409,
        ErrorCodes.DENIED,
        "Dispatch is unavailable or authorization was revoked."
      );
    }
    if (!(await dispatchAuthorized(current))) {
      const cancelled = await options.store.requestCancel(body.dispatchId, now());
      if (cancelled?.status !== "cancel_requested") {
        return apiError(reply, 409, ErrorCodes.DENIED, "Dispatch authorization was revoked.");
      }
    }
    const dispatch = await options.store.acknowledge(body.dispatchId, body.leaseToken, now());
    if (!dispatch || dispatch.nodeId !== nodeId) {
      return apiError(reply, 409, ErrorCodes.LEASE_EXPIRED, "lease is invalid or expired");
    }
    return {
      acknowledged: true,
      cancelRequested: dispatch.status === "cancel_requested",
      leaseExpiresAt: dispatch.leaseExpiresAt
    };
  });

  app.post(
    "/api/v1/nodes/:nodeId/leases/renew",
    { preHandler: requireNode },
    async (request, reply) => {
      const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
      const body = z
        .object({ dispatchId: z.string(), leaseToken: z.string() })
        .strict()
        .parse(request.body);
      const current = await options.store.getDispatchById(body.dispatchId);
      if (!current || current.nodeId !== nodeId) {
        return apiError(reply, 409, ErrorCodes.LEASE_EXPIRED, "lease is invalid or expired");
      }
      if (!(await dispatchAuthorized(current)))
        await options.store.requestCancel(body.dispatchId, now());
      const dispatch = await options.store.renewLease(
        body.dispatchId,
        body.leaseToken,
        now(),
        leaseMs
      );
      if (!dispatch || dispatch.nodeId !== nodeId) {
        return apiError(reply, 409, ErrorCodes.LEASE_EXPIRED, "lease is invalid or expired");
      }
      return {
        renewed: true,
        leaseExpiresAt: dispatch.leaseExpiresAt,
        cancelRequested: dispatch.status === "cancel_requested"
      };
    }
  );

  app.post(
    "/api/v1/nodes/:nodeId/receipts",
    { preHandler: requireNode },
    async (request, reply) => {
      const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
      const body = z
        .object({
          dispatchId: z.string(),
          leaseToken: z.string(),
          result: ResultSchema,
          receipt: z.unknown().optional()
        })
        .strict()
        .parse(request.body);
      const current = await options.store.getDispatchById(body.dispatchId);
      if (
        !current ||
        current.nodeId !== nodeId ||
        current.invocation.invocationId !== body.result.invocationId ||
        current.invocation.attemptId !== body.result.attemptId ||
        !["succeeded", "failed", "denied", "cancelled", "unknown_outcome"].includes(
          body.result.status
        ) ||
        (body.result.receipt &&
          (body.result.receipt.nodeId !== nodeId ||
            body.result.receipt.invocationId !== current.invocation.invocationId ||
            body.result.receipt.attemptId !== current.invocation.attemptId ||
            body.result.receipt.tool !== current.invocation.tool ||
            body.result.receipt.terminalStatus !== body.result.status))
      ) {
        return apiError(reply, 400, ErrorCodes.INVALID_REQUEST, "receipt does not match dispatch");
      }
      const completed = await options.store.complete(
        body.dispatchId,
        body.leaseToken,
        body.result,
        body.result.receipt,
        now()
      );
      if (!completed) {
        return apiError(reply, 409, ErrorCodes.LEASE_EXPIRED, "lease is invalid or superseded");
      }
      countInvocation(completed.status, completed.invocation.tool);
      return { accepted: true, status: completed.status };
    }
  );

  app.post(
    "/api/v1/nodes/:nodeId/artifacts",
    { preHandler: requireNode },
    async (request, reply) => {
      const { nodeId } = z.object({ nodeId: z.string() }).parse(request.params);
      const body = z
        .object({
          dispatchId: z.string(),
          artifactId: z.string().regex(/^artifact_[a-f0-9]{32}\.log$/),
          contentType: z.string().min(1).max(128),
          sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          dataBase64: z.string().max(35 * 1024 * 1024)
        })
        .strict()
        .parse(request.body);
      const dispatch = await options.store.getDispatchById(body.dispatchId);
      if (!dispatch || dispatch.nodeId !== nodeId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "dispatch was not found");
      }
      const data = Buffer.from(body.dataBase64, "base64");
      if (data.byteLength > 25 * 1024 * 1024) {
        return apiError(reply, 413, ErrorCodes.INVALID_REQUEST, "artifact exceeds upload limit");
      }
      const contentHash = `sha256:${createHash("sha256").update(data).digest("hex")}`;
      if (!secureEqual(contentHash, body.sha256)) {
        return apiError(reply, 400, ErrorCodes.INVALID_REQUEST, "artifact hash mismatch");
      }
      await options.store.putArtifact({
        artifactId: body.artifactId,
        accountId: dispatch.invocation.accountId,
        invocationId: dispatch.invocation.invocationId,
        nodeId,
        contentType: body.contentType,
        sha256: body.sha256,
        data,
        createdAt: now().toISOString()
      });
      return { accepted: true, artifactId: body.artifactId };
    }
  );

  async function invoke(invocation: Invocation, principal: Principal): Promise<InvocationResult> {
    const accountId = principal.accountId;
    assertInvocationCurrent(invocation, now());
    countInvocation("submitted", invocation.tool);
    if (invocation.accountId !== accountId) {
      throw new ProtocolError(ErrorCodes.DENIED, "account scope mismatch", false);
    }
    if (principal.kind === "agent" && invocation.authorization.grantId !== principal.grantId) {
      throw new ProtocolError("denied", "Credential is bound to a different Agent grant.", false);
    }
    const grant = await options.store.getGrant(invocation.authorization.grantId);
    if (
      !grant ||
      grant.revokedAt ||
      grant.accountId !== accountId ||
      grant.actorId !== invocation.actor.id
    ) {
      return domainResult(invocation, "denied", {
        code: ErrorCodes.DENIED,
        message: "agent grant is missing or revoked",
        retryable: false
      });
    }
    if (
      grant.projectId &&
      (invocation.authorization.projectId !== grant.projectId ||
        ("projectId" in invocation.target && invocation.target.projectId !== grant.projectId))
    ) {
      throw new ProtocolError("denied", "Project scope mismatch.", false);
    }
    if (!isBuiltinTool(invocation.tool) && !("nodeId" in invocation.target)) {
      throw new ProtocolError(
        "invalid_request",
        "Custom MCP tools require an explicit target node.",
        false
      );
    }
    const existing = await options.store.getDispatchByInvocation(invocation.invocationId);
    if (existing) {
      const identity = (value: Invocation) => ({
        accountId: value.accountId,
        actor: value.actor,
        tool: value.tool,
        args: value.args,
        authorization: value.authorization,
        target: value.target,
        idempotencyKey: value.idempotencyKey
      });
      if (sha256(identity(existing.invocation)) !== sha256(identity(invocation))) {
        throw new ProtocolError("conflict", "Invocation ID has already been used.", false);
      }
      return existing.result ?? queuedResult(existing);
    }
    if (!grant.allowedTools.includes(ToolIdSchema.parse(invocation.tool))) {
      return domainResult(invocation, "denied", {
        code: ErrorCodes.DENIED,
        message: "agent grant does not include this control-plane capability",
        retryable: false
      });
    }
    if (invocation.tool === "device.list" || invocation.tool === "device.status") {
      const requestedNodeId =
        invocation.tool === "device.status"
          ? (invocation.args as { nodeId: string }).nodeId
          : undefined;
      const nodes = (await options.store.listNodes(accountId))
        .filter(
          (node) =>
            grant.nodeIds.includes(node.nodeId) &&
            (requestedNodeId === undefined || node.nodeId === requestedNodeId)
        )
        .map((node) => ({ ...node, capability: effectiveCapability(node) }))
        .map((node) => ({
          nodeId: node.nodeId,
          label: node.label,
          platform: node.platform,
          status: node.status,
          lastSeenAt: node.lastSeenAt,
          capability: node.capability
            ? {
                ...node.capability,
                roots: node.capability.roots.filter(
                  (root) => grant.rootAccess === "all" || grant.rootIds.includes(root.rootId)
                ),
                tools: node.capability.tools.filter((tool) =>
                  grant.allowedTools.includes(tool.name)
                )
              }
            : undefined
        }));
      if (requestedNodeId && nodes.length === 0) {
        return domainResult(invocation, "denied", {
          code: ErrorCodes.DENIED,
          message: "device is not visible to this agent",
          retryable: false
        });
      }
      countInvocation("succeeded", invocation.tool);
      return ResultSchema.parse({
        schemaVersion: "0.1",
        invocationId: invocation.invocationId,
        attemptId: invocation.attemptId,
        status: "succeeded",
        output: invocation.tool === "device.list" ? { nodes } : { node: nodes[0] }
      });
    }
    if (
      invocation.tool === "task.status" ||
      invocation.tool === "task.result" ||
      invocation.tool === "task.cancel"
    ) {
      const jobId = (invocation.args as { jobId: string }).jobId;
      const dispatchId = dispatchIdForJob(jobId);
      let task = dispatchId ? await options.store.getDispatchById(dispatchId) : undefined;
      if (
        !task ||
        task.invocation.accountId !== accountId ||
        task.invocation.authorization.grantId !== grant.grantId
      ) {
        return domainResult(invocation, "denied", {
          code: ErrorCodes.DENIED,
          message: "task is not visible to this agent",
          retryable: false
        });
      }
      if (invocation.tool === "task.cancel") {
        task = await options.store.requestCancel(task.dispatchId, now());
      }
      countInvocation("succeeded", invocation.tool);
      return ResultSchema.parse({
        schemaVersion: "0.1",
        invocationId: invocation.invocationId,
        attemptId: invocation.attemptId,
        status: "succeeded",
        output: { task: task?.result ?? (task ? queuedResult(task) : undefined) }
      });
    }
    const placement = await placeInvocation(options.store, invocation, grant);
    if ("error" in placement) {
      return domainResult(invocation, placement.status, placement.error);
    }
    const node = placement.node;
    const policyDecision = await policyFor(invocation, grant, node);
    if (policyDecision.outcome !== "allow") {
      const offline = policyDecision.reasonCode === "node.offline";
      countInvocation(offline ? "offline" : policyDecision.outcome, invocation.tool);
      if (policyDecision.outcome === "approval_required") {
        const createdAt = now();
        const approval = await options.store.putApproval({
          approvalId: createId("apr"),
          accountId,
          invocation,
          nodeId: node.nodeId,
          placementReason: placement.reason,
          policyDecision,
          status: "pending",
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(
            Math.min(Date.parse(invocation.expiresAt), createdAt.getTime() + 15 * 60_000)
          ).toISOString()
        });
        await options.store.putAudit({
          eventId: createId("dsp"),
          accountId,
          invocationId: invocation.invocationId,
          type: "approval.requested",
          payload: {
            approvalId: approval.approvalId,
            nodeId: node.nodeId,
            policyDecision
          },
          createdAt: createdAt.toISOString()
        });
        return domainResult(invocation, "approval_required", {
          code: ErrorCodes.APPROVAL_REQUIRED,
          message: policyDecision.explanation,
          retryable: false,
          details: {
            approvalId: approval.approvalId,
            expiresAt: approval.expiresAt,
            reasonCode: policyDecision.reasonCode,
            policyDecision
          }
        });
      }
      return domainResult(invocation, offline ? "offline" : "denied", {
        code: offline ? ErrorCodes.OFFLINE : ErrorCodes.DENIED,
        message: policyDecision.explanation,
        retryable: offline,
        details: {
          reasonCode: policyDecision.reasonCode,
          policyDecision
        }
      });
    }
    const timestamp = now().toISOString();
    const dispatch: DispatchRecord = {
      dispatchId: createId("dsp"),
      invocation,
      nodeId: node.nodeId,
      policyDecision,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const queued = await options.store.enqueue(dispatch, {
      eventId: createId("dsp"),
      accountId,
      invocationId: invocation.invocationId,
      type: "dispatch.queued",
      payload: {
        dispatchId: dispatch.dispatchId,
        nodeId: node.nodeId,
        placementReason: placement.reason,
        policyDecision
      },
      createdAt: timestamp
    });
    wakeNode(queued.nodeId);
    countInvocation("queued", invocation.tool);
    return queued.result ?? queuedResult(queued);
  }

  app.post("/api/v1/invocations", { preHandler: requireAuthenticated }, async (request) =>
    invoke(InvocationSchema.parse(request.body), principals.get(request)!)
  );

  function visibleTask(request: FastifyRequest, dispatch: DispatchRecord | undefined) {
    const principal = principals.get(request)!;
    return (
      !!dispatch &&
      dispatch.invocation.accountId === principal.accountId &&
      (principal.kind === "session" ||
        principal.kind === "pat" ||
        dispatch.invocation.authorization.grantId === principal.grantId)
    );
  }

  app.get(
    "/api/v1/invocations/:invocationId",
    { preHandler: requireAuthenticated },
    async (request, reply) => {
      const { invocationId } = z.object({ invocationId: InvocationIdSchema }).parse(request.params);
      const principal = principals.get(request)!;
      const dispatch = await options.store.getDispatchByInvocation(invocationId);
      if (dispatch) {
        if (!visibleTask(request, dispatch)) {
          return apiError(reply, 404, ErrorCodes.NOT_FOUND, "invocation was not found");
        }
        if (principal.kind === "agent") {
          const grant = await options.store.getGrant(principal.grantId);
          if (
            !grant?.allowedTools.some((tool) => tool === "task.status" || tool === "task.result")
          ) {
            return apiError(reply, 403, ErrorCodes.DENIED, "Task results are not granted.");
          }
        }
        return dispatch.result ?? queuedResult(dispatch);
      }

      const approval = await options.store.getApprovalByInvocation(invocationId);
      if (
        !approval ||
        approval.accountId !== principal.accountId ||
        (principal.kind === "agent" &&
          approval.invocation.authorization.grantId !== principal.grantId)
      ) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "invocation was not found");
      }
      const approvalExpired = Date.parse(approval.expiresAt) <= now().getTime();
      if (approval.status === "pending" && !approvalExpired) {
        return domainResult(approval.invocation, "approval_required", {
          code: ErrorCodes.APPROVAL_REQUIRED,
          message: approval.policyDecision.explanation,
          retryable: false,
          details: {
            approvalId: approval.approvalId,
            expiresAt: approval.expiresAt,
            reasonCode: approval.policyDecision.reasonCode,
            policyDecision: approval.policyDecision
          }
        });
      }
      return domainResult(approval.invocation, "denied", {
        code:
          approval.status === "expired" || approvalExpired ? ErrorCodes.EXPIRED : ErrorCodes.DENIED,
        message:
          approval.status === "expired" || approvalExpired
            ? "Approval expired before the invocation was dispatched."
            : "The invocation was denied by the account owner.",
        retryable: false,
        details: { approvalId: approval.approvalId }
      });
    }
  );

  app.get("/api/v1/tasks/:jobId", { preHandler: requireAuthenticated }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const dispatchId = dispatchIdForJob(jobId);
    const dispatch = dispatchId ? await options.store.getDispatchById(dispatchId) : undefined;
    if (!dispatch || !visibleTask(request, dispatch)) {
      return apiError(reply, 404, ErrorCodes.NOT_FOUND, "task was not found");
    }
    const actor = principals.get(request)!;
    if (actor.kind === "agent") {
      const grant = await options.store.getGrant(actor.grantId);
      if (!grant?.allowedTools.some((tool) => tool === "task.status" || tool === "task.result")) {
        return apiError(reply, 403, ErrorCodes.DENIED, "Task results are not granted.");
      }
    }
    return dispatch.result ?? queuedResult(dispatch);
  });

  app.post(
    "/api/v1/tasks/:jobId/cancel",
    { preHandler: requireAuthenticated },
    async (request, reply) => {
      const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
      const dispatchId = dispatchIdForJob(jobId);
      const current = dispatchId ? await options.store.getDispatchById(dispatchId) : undefined;
      if (!current || !visibleTask(request, current)) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "task was not found");
      }
      const actor = principals.get(request)!;
      if (
        actor.kind === "agent" &&
        !(await options.store.getGrant(actor.grantId))?.allowedTools.includes("task.cancel")
      ) {
        return apiError(reply, 403, ErrorCodes.DENIED, "Task cancellation is not granted.");
      }
      const dispatch = (await options.store.requestCancel(current.dispatchId, now()))!;
      if (dispatch.status === "cancelled" || dispatch.status === "cancel_requested") {
        await options.store.putAudit({
          eventId: createId("dsp"),
          accountId: dispatch.invocation.accountId,
          invocationId: dispatch.invocation.invocationId,
          type: dispatch.status === "cancelled" ? "task.cancelled" : "task.cancel_requested",
          payload: {
            dispatchId: dispatch.dispatchId,
            nodeId: dispatch.nodeId,
            status: dispatch.status
          },
          createdAt: now().toISOString()
        });
      }
      if (dispatch.status === "cancelled") {
        return ResultSchema.parse({
          schemaVersion: "0.1",
          invocationId: dispatch.invocation.invocationId,
          attemptId: dispatch.invocation.attemptId,
          status: "cancelled",
          error: {
            code: ErrorCodes.CANCELLED,
            message: "task was cancelled before execution",
            retryable: false
          },
          jobId
        });
      }
      return dispatch.result ?? queuedResult(dispatch);
    }
  );

  app.get("/api/v1/approvals", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(512).optional(),
        status: z.enum(["pending", "resolved"]).optional()
      })
      .strict()
      .parse(request.query);
    const before = query.cursor ? decodePageCursor(query.cursor) : undefined;
    const page = await options.store.listApprovalsPage(accountId, {
      limit: query.limit,
      now: now().toISOString(),
      ...(before ? { before } : {}),
      ...(query.status ? { status: query.status } : {})
    });
    return {
      approvals: await approvalView(options.store, accountId, page.approvals),
      nextCursor: encodePageCursor(page.nextCursor),
      hasMore: !!page.nextCursor,
      pendingCount: page.pendingCount
    };
  });

  app.post(
    "/api/v1/approvals/:approvalId",
    { preHandler: requireOwner },
    async (request, reply) => {
      const accountId = accountOf(request);
      const { approvalId } = z.object({ approvalId: z.string() }).parse(request.params);
      const { decision } = z
        .object({ decision: z.enum(["approved", "denied"]) })
        .strict()
        .parse(request.body);
      const approval = await options.store.getApproval(approvalId);
      if (!approval || approval.accountId !== accountId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "approval was not found");
      }
      if (approval.status === "approved") {
        const existing = await options.store.getDispatchByInvocation(
          approval.invocation.invocationId
        );
        if (existing) return existing.result ?? queuedResult(existing);
      }
      if (approval.status !== "pending") {
        return apiError(reply, 409, ErrorCodes.CONFLICT, `approval is already ${approval.status}`);
      }
      const timestamp = now();
      if (Date.parse(approval.expiresAt) <= timestamp.getTime()) {
        await options.store.resolveApproval(approvalId, "approved", timestamp);
        return apiError(reply, 409, ErrorCodes.EXPIRED, "approval has expired");
      }
      if (decision === "denied") {
        const resolved = await options.store.resolveApproval(approvalId, "denied", timestamp);
        if (!resolved)
          return apiError(reply, 409, ErrorCodes.CONFLICT, "Approval was already resolved.");
        await options.store.putAudit({
          eventId: createId("dsp"),
          accountId,
          invocationId: approval.invocation.invocationId,
          type: "approval.denied",
          payload: { approvalId, nodeId: approval.nodeId },
          createdAt: timestamp.toISOString()
        });
        return { approval: resolved };
      }
      const node = await options.store.getNode(approval.nodeId);
      const grant = await options.store.getGrant(approval.invocation.authorization.grantId);
      if (
        !node ||
        node.status !== "active" ||
        !grant ||
        grant.revokedAt ||
        !(await dispatchAuthorized(
          {
            invocation: approval.invocation,
            nodeId: approval.nodeId,
            policyDecision: approval.policyDecision
          },
          true
        ))
      ) {
        return apiError(
          reply,
          409,
          ErrorCodes.DENIED,
          "device or grant was revoked before approval"
        );
      }
      const unsignedDecision = {
        outcome: "allow" as const,
        reasonCode: "approval.granted",
        explanation: "An owner approved this invocation.",
        evaluatedLayers: approval.policyDecision.evaluatedLayers,
        profile: approval.policyDecision.profile
      };
      const approvedDecision = {
        ...unsignedDecision,
        decisionHash: sha256(unsignedDecision)
      };
      const createdAt = timestamp.toISOString();
      const dispatch: DispatchRecord = {
        dispatchId: createId("dsp"),
        invocation: approval.invocation,
        nodeId: approval.nodeId,
        policyDecision: approvedDecision,
        status: "queued",
        createdAt,
        updatedAt: createdAt
      };
      const queued = await options.store.approveAndEnqueue(
        approvalId,
        dispatch,
        {
          eventId: createId("dsp"),
          accountId,
          invocationId: approval.invocation.invocationId,
          type: "dispatch.queued",
          payload: {
            dispatchId: dispatch.dispatchId,
            nodeId: approval.nodeId,
            placementReason: approval.placementReason,
            approvalId,
            policyDecision: approvedDecision
          },
          createdAt
        },
        timestamp
      );
      if (!queued)
        return apiError(
          reply,
          409,
          ErrorCodes.CONFLICT,
          "Approval was already resolved or expired."
        );
      wakeNode(queued.nodeId);
      return queued.result ?? queuedResult(queued);
    }
  );

  app.get("/api/v1/audit", { preHandler: requireOwner }, async (request) => {
    const accountId = accountOf(request);
    const query = z
      .object({
        invocationId: InvocationIdSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(512).optional(),
        category: AuditCategorySchema.optional()
      })
      .strict()
      .parse(request.query);
    const before = query.cursor ? decodePageCursor(query.cursor) : undefined;
    const page = await options.store.listAuditPage(accountId, {
      limit: query.limit,
      ...(query.invocationId ? { invocationId: query.invocationId } : {}),
      ...(query.category ? { eventTypePrefix: query.category } : {}),
      ...(before ? { before } : {})
    });
    return {
      events: await auditView(options.store, accountId, page.events),
      nextCursor: encodePageCursor(page.nextCursor),
      hasMore: !!page.nextCursor
    };
  });

  app.get(
    "/api/v1/artifacts/:artifactId",
    { preHandler: requireAuthenticated },
    async (request, reply) => {
      const accountId = accountOf(request);
      const { artifactId } = z.object({ artifactId: z.string() }).parse(request.params);
      const artifact = await options.store.getArtifact(artifactId);
      if (!artifact || artifact.accountId !== accountId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "artifact was not found");
      }
      const dispatch = await options.store.getDispatchByInvocation(artifact.invocationId);
      if (!visibleTask(request, dispatch)) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "artifact was not found");
      }
      return reply
        .type(artifact.contentType)
        .header("content-disposition", `attachment; filename="${artifact.artifactId}"`)
        .send(artifact.data);
    }
  );

  app.post("/mcp", { preHandler: requireAuthenticated }, async (request, reply) => {
    const principal = principals.get(request)!;
    if (principal.kind !== "agent") {
      return apiError(reply, 403, ErrorCodes.DENIED, "MCP requires a scoped Agent authorization.");
    }
    const grant = await options.store.getGrant(principal.grantId);
    if (!grant || grant.revokedAt || grant.accountId !== principal.accountId) {
      return apiError(reply, 403, ErrorCodes.DENIED, "Agent authorization is unavailable.");
    }
    const server = createMcpServer({
      client: { invoke: (invocation) => invoke(invocation, principal) },
      context: grantContext(grant, await options.store.listNodes(grant.accountId)),
      allowedTools: grant.allowedTools
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    } as any);
    reply.hijack();
    await server.connect(transport as any);
    reply.raw.once("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    preHandler: requireAuthenticated,
    handler: async (_request, reply) => reply.code(405).header("allow", "POST").send()
  });

  registerDistributionRoutes(app, options.nodeDistribution);
  app.get("/api/v1/node-installation", { preHandler: requireOwner }, async () =>
    distributionInfo(options.nodeDistribution)
  );

  if (options.consoleDirectory) {
    const publicSite = await PublicSite.load(options.consoleDirectory);
    await app.register(fastifyStatic, {
      root: publicSite.root,
      prefix: "/",
      wildcard: false,
      index: false
    });
    app.get("/robots.txt", async (_request, reply) =>
      reply.type("text/plain; charset=utf-8").send(publicSite.robots(options.access.origin))
    );
    app.get("/sitemap.xml", async (_request, reply) =>
      reply.type("application/xml; charset=utf-8").send(publicSite.sitemap(options.access.origin))
    );
    app.get("/llms.txt", async (_request, reply) =>
      reply.type("text/plain; charset=utf-8").send(publicSite.llms(options.access.origin))
    );
    app.get("/llms-full.txt", async (_request, reply) =>
      reply.type("text/plain; charset=utf-8").send(publicSite.llmsFull(options.access.origin))
    );
    app.get("/feed.xml", async (_request, reply) =>
      reply.type("application/rss+xml; charset=utf-8").send(publicSite.feed(options.access.origin))
    );
    const serveConsole = async (request: FastifyRequest, reply: FastifyReply) => {
      const pathname = new URL(request.url, options.access.origin).pathname;
      if (pathname.startsWith("/assets/")) {
        return reply.sendFile(pathname.slice(1), {
          immutable: true,
          maxAge: "1y"
        });
      }
      if (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/downloads/") ||
        pathname === "/mcp"
      ) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "route was not found");
      }
      const rendered = publicSite.renderHtml(pathname, options.access.origin, options.analytics);
      if (!rendered.isPublic) reply.header("x-robots-tag", "noindex, nofollow");
      return reply
        .type("text/html; charset=utf-8")
        .header("cache-control", "no-cache")
        .send(rendered.html);
    };
    app.get("/", serveConsole);
    app.get("/*", serveConsole);
  }

  app.addHook("onClose", async () => {
    wakeHub.close();
    await options.store.close();
  });
  return app;
}

function requestLogError(app: FastifyInstance, error: unknown): void {
  app.log.error({ err: error }, "unhandled control plane error");
}

async function placeInvocation(
  store: Store,
  invocation: Invocation,
  grant: AgentGrantRecord
): Promise<
  | { node: NonNullable<Awaited<ReturnType<Store["getNode"]>>>; reason: string }
  | {
      status: "denied" | "offline";
      error: AdcError;
    }
> {
  if ("nodeId" in invocation.target) {
    const node = await store.getNode(invocation.target.nodeId);
    if (!node || node.accountId !== invocation.accountId || !grant.nodeIds.includes(node.nodeId)) {
      return {
        status: "denied",
        error: {
          code: ErrorCodes.DENIED,
          message: "explicit target is not visible to this agent",
          retryable: false
        }
      };
    }
    return { node, reason: "explicit_node" };
  }

  const roots = await store.listRoots(invocation.target.projectId);
  const requestedRoots = new Set(invocation.authorization.rootIds);
  const candidateIds = [
    ...new Set(
      roots
        .filter(
          (root) =>
            grant.nodeIds.includes(root.nodeId) &&
            grant.rootIds.includes(root.rootId) &&
            (requestedRoots.size === 0 || requestedRoots.has(root.rootId))
        )
        .map((root) => root.nodeId)
    )
  ].sort();
  if (candidateIds.length === 0) {
    return {
      status: "denied",
      error: {
        code: ErrorCodes.DENIED,
        message: "no granted device is bound to the project and requested roots",
        retryable: false
      }
    };
  }
  if (candidateIds.length > 1 && !invocation.target.affinity) {
    return {
      status: "denied",
      error: {
        code: ErrorCodes.AMBIGUOUS_TARGET,
        message: "multiple devices match; specify nodeId or affinity",
        retryable: false,
        details: { candidates: candidateIds }
      }
    };
  }
  const selectedId = invocation.target.affinity
    ? candidateIds[
        Number.parseInt(hash(invocation.target.affinity).slice(0, 8), 16) % candidateIds.length
      ]!
    : candidateIds[0]!;
  const node = await store.getNode(selectedId);
  if (!node) {
    return {
      status: "offline",
      error: {
        code: ErrorCodes.OFFLINE,
        message: "bound device no longer exists",
        retryable: false
      }
    };
  }
  return {
    node,
    reason: invocation.target.affinity ? "project_affinity" : "project_single_binding"
  };
}
