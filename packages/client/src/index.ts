import { randomBytes } from "node:crypto";
import {
  CapabilitySchema,
  ErrorSchema,
  InvocationSchema,
  ResultSchema,
  absolutePathForToolArgs,
  createId,
  isSideEffectTool,
  rootForAbsolutePath,
  type AdcError,
  type CapabilityAdvertisement,
  type Invocation,
  type InvocationResult,
  type NodePlatform,
  type PolicyDecision,
  type ToolCapability,
  type ToolId
} from "@adc/protocol";
import { signNodeRequest } from "./node-auth.ts";

export * from "./node-auth.ts";

type Fetch = typeof globalThis.fetch;

export interface InvocationContext {
  accountId: string;
  actorId: string;
  grantId: string;
  projectId?: string;
  nodeIds?: string[];
  allowedTools?: ToolId[];
  toolNodeIds?: Partial<Record<ToolId, string[]>>;
  toolDefinitions?: Partial<Record<ToolId, ToolCapability>>;
  rootAccess?: "selected" | "all";
  rootsByNode?: Record<string, string[]>;
  resourcesByNode?: Record<string, Array<{ rootId: string; path?: string }>>;
  rootIds: string[];
}

export type AccessProfile = "read-only" | "workspace-write" | "approve-required" | "unattended";
export type ApprovalPolicy = "never" | "writes" | "execute" | "always";

export interface NodeAccessPolicy {
  rootAccess: "selected" | "all";
  rootIds: string[];
  readOnlyRootIds: string[];
  allowExecution: boolean;
  maxConcurrency: number;
}

export interface NodeDispatch {
  dispatchId: string;
  leaseToken: string;
  invocation: Invocation;
  policyDecision: PolicyDecision;
}

export interface NodePollResponse {
  dispatch: NodeDispatch | null;
  maxConcurrency?: number;
}

export interface ManagedNode {
  nodeId: string;
  accountId: string;
  label: string;
  /** Free-form owner note shown to harness plugins and consoles. */
  description?: string;
  platform: NodePlatform;
  status: "active" | "revoked";
  accessPolicy?: NodeAccessPolicy;
  revision?: number;
  capability?: CapabilityAdvertisement;
  effectiveCapability?: CapabilityAdvertisement;
  lastSeenAt?: string;
  createdAt: string;
  deletedAt?: string;
  online: boolean;
}

export interface AccessSettings {
  name: string;
  projectId?: string;
  profile: AccessProfile;
  nodeIds: string[];
  rootAccess: "selected" | "all";
  rootIds: string[];
  approvalPolicy?: ApprovalPolicy;
  allowedTools: ToolId[];
}

export interface AgentAccess extends AccessSettings {
  grantId: string;
  accountId: string;
  actorId: string;
  revision?: number;
  createdAt: string;
  revokedAt?: string;
  deletedAt?: string;
  resourcesByNode?: Record<string, Array<{ rootId: string; path?: string }>>;
}

export interface CliConnection {
  credentialId: string;
  accountId: string;
  grantId: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface OAuthConnection {
  clientId: string;
  grantId: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Owner-level personal access token for headless management clients. */
export interface OwnerPat {
  patId: string;
  accountId: string;
  label: string;
  readOnly: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Project {
  projectId: string;
  accountId: string;
  label: string;
  createdAt: string;
}

export interface ProjectRoot {
  rootId: string;
  projectId: string;
  nodeId: string;
  path?: string;
  label: string;
  writable: boolean;
  createdAt: string;
}

export interface PendingApproval {
  approvalId: string;
  accountId: string;
  invocation: Invocation;
  nodeId: string;
  path?: string;
  placementReason: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
}

export type AuditCategory =
  "dispatch" | "approval" | "task" | "node" | "grant" | "credential" | "oauth";

export interface AuditPage {
  events: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApprovalPage {
  approvals: PendingApproval[];
  nextCursor: string | null;
  hasMore: boolean;
  pendingCount: number;
}

export interface NodeInstallation {
  available: boolean;
  controlPlaneUrl?: string;
  downloadUrl?: string;
  installerUrl?: string;
  windowsInstallerUrl?: string;
}

export function defaultTarget(context: InvocationContext, tool?: string): Invocation["target"] {
  if (context.projectId) return { projectId: context.projectId };
  const nodes = context.nodeIds ?? [];
  if (
    nodes.length === 1 ||
    (nodes.length > 0 && ["device.list", "device.status"].includes(tool ?? ""))
  )
    return { nodeId: nodes[0]! };
  throw new Error(
    nodes.length
      ? "Multiple devices are authorized; specify a target node."
      : "No device is authorized."
  );
}

function absolutePathTarget(context: InvocationContext): Invocation["target"] {
  const nodes = context.nodeIds ?? [];
  if (nodes.length === 1) return { nodeId: nodes[0]! };
  throw new Error(
    nodes.length
      ? "Multiple devices are authorized; specify target.nodeId for an absolute path."
      : "No device is authorized."
  );
}

export function buildInvocation(input: {
  context: InvocationContext;
  tool: string;
  args: unknown;
  target?: { nodeId: string } | { projectId: string; affinity?: string };
  source: "http" | "cli" | "mcp" | "sdk" | "skill" | "internal";
  idempotencyKey?: string;
  timeoutMs?: number;
}): Invocation {
  const issuedAt = new Date();
  const tool = input.tool;
  if (isSideEffectTool(tool) && !input.idempotencyKey) {
    throw new Error("idempotencyKey is required for side-effecting tools");
  }
  const args = (input.args ?? {}) as Record<string, unknown>;
  const absolutePath = absolutePathForToolArgs(tool, args);
  const target =
    input.target ??
    (absolutePath ? absolutePathTarget(input.context) : defaultTarget(input.context, tool));
  if (absolutePath && !("nodeId" in target)) {
    throw new Error("Absolute paths require an explicit target.nodeId.");
  }
  const legacyRootId = typeof args.rootId === "string" ? args.rootId : undefined;
  const absoluteRoot =
    absolutePath && "nodeId" in target
      ? rootForAbsolutePath(absolutePath, input.context.resourcesByNode?.[target.nodeId] ?? [])
      : undefined;
  if (absolutePath && !absoluteRoot) {
    throw new Error("The absolute path is outside this agent's authorized device folders.");
  }
  const targetRootIds =
    "nodeId" in target
      ? (input.context.rootsByNode?.[target.nodeId] ??
        input.context.resourcesByNode?.[target.nodeId]?.map((root) => root.rootId))
      : undefined;
  const rootIds = legacyRootId
    ? input.context.rootAccess === "all"
      ? [legacyRootId]
      : input.context.rootIds
    : absoluteRoot
      ? [absoluteRoot.rootId]
      : input.context.rootAccess === "all"
        ? (targetRootIds ?? input.context.rootIds)
        : input.context.rootIds;
  return InvocationSchema.parse({
    schemaVersion: "0.1",
    invocationId: createId("inv"),
    attemptId: createId("att"),
    accountId: input.context.accountId,
    actor: { type: "agent", id: input.context.actorId },
    target,
    authorization: {
      ...(input.context.projectId ? { projectId: input.context.projectId } : {}),
      rootIds,
      grantId: input.context.grantId
    },
    tool: input.tool,
    args: input.args,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + (input.timeoutMs ?? 5 * 60_000)).toISOString(),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    metadata: { source: input.source }
  });
}

export class AdcClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly error: AdcError
  ) {
    super(error.message);
    this.name = "AdcClientError";
  }
}

export class AdcClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly credential: string | { cookie: string } | { sessionToken: string },
    private readonly fetcher: Fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    if (typeof this.credential === "string") return { authorization: `Bearer ${this.credential}` };
    if ("sessionToken" in this.credential)
      return {
        authorization: `Bearer ${this.credential.sessionToken}`,
        origin: new URL(this.baseUrl).origin
      };
    return { cookie: this.credential.cookie, origin: new URL(this.baseUrl).origin };
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        "content-type": "application/json",
        ...init.headers
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = ErrorSchema.safeParse((body as any).error ?? body);
      throw new AdcClientError(
        response.status,
        parsed.success
          ? parsed.data
          : {
              code: "internal",
              message: `control plane returned HTTP ${response.status}`,
              retryable: response.status >= 500
            }
      );
    }
    return body;
  }

  async me(): Promise<
    | {
        kind: "session";
        user: { id: string; name: string; email: string };
        account: { accountId: string; name: string };
      }
    | {
        kind: "agent";
        context: InvocationContext;
        grant: { allowedTools: ToolId[]; name: string };
      }
  > {
    return (await this.request("/api/v1/me")) as Awaited<ReturnType<AdcClient["me"]>>;
  }

  async listNodes(): Promise<ManagedNode[]> {
    const response = (await this.request("/api/v1/nodes")) as { nodes: ManagedNode[] };
    return response.nodes;
  }

  async nodeInstallation(): Promise<NodeInstallation> {
    return (await this.request("/api/v1/node-installation")) as NodeInstallation;
  }

  async updateNode(
    nodeId: string,
    input: {
      revision: number;
      label: string;
      description?: string;
      accessPolicy: NodeAccessPolicy;
    }
  ): Promise<ManagedNode> {
    return (await this.request(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    })) as ManagedNode;
  }

  async revokeNode(nodeId: string): Promise<{ revoked: true; nodeId: string }> {
    return (await this.request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/revoke`, {
      method: "POST",
      body: "{}"
    })) as { revoked: true; nodeId: string };
  }

  async deleteNode(nodeId: string, revision: number): Promise<{ deleted: true }> {
    return (await this.request(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
      method: "DELETE",
      body: JSON.stringify({ revision })
    })) as { deleted: true };
  }

  async listProjects(): Promise<Project[]> {
    const response = (await this.request("/api/v1/projects")) as { projects: Project[] };
    return response.projects;
  }

  async createProject(input: { projectId?: string; label: string }): Promise<Project> {
    return (await this.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(input)
    })) as Project;
  }

  async listProjectRoots(projectId: string): Promise<ProjectRoot[]> {
    const response = (await this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/roots`
    )) as { roots: ProjectRoot[] };
    return response.roots;
  }

  async addProjectRoot(
    projectId: string,
    input: { rootId: string; nodeId: string; label: string; writable: boolean }
  ): Promise<ProjectRoot> {
    return (await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/roots`, {
      method: "POST",
      body: JSON.stringify(input)
    })) as ProjectRoot;
  }

  async createPairingCode(ttlSeconds = 600): Promise<{ code: string; expiresAt: string }> {
    return (await this.request("/api/v1/pairing-codes", {
      method: "POST",
      body: JSON.stringify({ ttlSeconds })
    })) as { code: string; expiresAt: string };
  }

  async listAccess(): Promise<AgentAccess[]> {
    const response = (await this.request("/api/v1/grants")) as { grants: AgentAccess[] };
    return response.grants;
  }

  async createAccess(
    input: AccessSettings & { grantId?: string; actorId?: string }
  ): Promise<AgentAccess> {
    return (await this.request("/api/v1/grants", {
      method: "POST",
      body: JSON.stringify(input)
    })) as AgentAccess;
  }

  async updateAccess(
    grantId: string,
    input: AccessSettings & { revision: number }
  ): Promise<AgentAccess> {
    return (await this.request(`/api/v1/grants/${encodeURIComponent(grantId)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    })) as AgentAccess;
  }

  async revokeAccess(grantId: string): Promise<{ revoked: true }> {
    return (await this.request(`/api/v1/grants/${encodeURIComponent(grantId)}/revoke`, {
      method: "POST",
      body: "{}"
    })) as { revoked: true };
  }

  async deleteAccess(grantId: string, revision: number): Promise<{ deleted: true }> {
    return (await this.request(`/api/v1/grants/${encodeURIComponent(grantId)}`, {
      method: "DELETE",
      body: JSON.stringify({ revision })
    })) as { deleted: true };
  }

  async listConnections(): Promise<CliConnection[]> {
    const response = (await this.request("/api/v1/credentials")) as {
      credentials: CliConnection[];
    };
    return response.credentials;
  }

  async createConnection(input: {
    name: string;
    grantId: string;
    expiresInDays?: number;
  }): Promise<{ credential: CliConnection; token: string }> {
    return (await this.request("/api/v1/credentials", {
      method: "POST",
      body: JSON.stringify(input)
    })) as { credential: CliConnection; token: string };
  }

  async revokeConnection(credentialId: string): Promise<{ revoked: true }> {
    return (await this.request(`/api/v1/credentials/${encodeURIComponent(credentialId)}/revoke`, {
      method: "POST",
      body: "{}"
    })) as { revoked: true };
  }

  async listPats(): Promise<OwnerPat[]> {
    const response = (await this.request("/api/v1/pats")) as { pats: OwnerPat[] };
    return response.pats;
  }

  async createPat(input: {
    label: string;
    readOnly?: boolean;
    expiresInDays?: number;
  }): Promise<{ pat: OwnerPat; token: string }> {
    return (await this.request("/api/v1/pats", {
      method: "POST",
      body: JSON.stringify({ readOnly: false, ...input })
    })) as { pat: OwnerPat; token: string };
  }

  async revokePat(patId: string): Promise<{ revoked: true }> {
    return (await this.request(`/api/v1/pats/${encodeURIComponent(patId)}/revoke`, {
      method: "POST",
      body: "{}"
    })) as { revoked: true };
  }

  async listOAuthConnections(): Promise<OAuthConnection[]> {
    const response = (await this.request("/api/v1/oauth/bindings")) as {
      bindings: OAuthConnection[];
    };
    return response.bindings;
  }

  async revokeOAuthConnection(clientId: string): Promise<{ revoked: true }> {
    return (await this.request("/api/v1/oauth/bindings/revoke", {
      method: "POST",
      body: JSON.stringify({ clientId })
    })) as { revoked: true };
  }

  async invoke(input: Invocation): Promise<InvocationResult> {
    const invocation = InvocationSchema.parse(input);
    const response = await this.request("/api/v1/invocations", {
      method: "POST",
      body: JSON.stringify(invocation)
    });
    return ResultSchema.parse(response);
  }

  async invocationStatus(invocationId: string): Promise<InvocationResult> {
    return ResultSchema.parse(
      await this.request(`/api/v1/invocations/${encodeURIComponent(invocationId)}`)
    );
  }

  async taskStatus(jobId: string): Promise<InvocationResult> {
    return ResultSchema.parse(await this.request(`/api/v1/tasks/${encodeURIComponent(jobId)}`));
  }

  async cancelTask(jobId: string): Promise<InvocationResult> {
    return ResultSchema.parse(
      await this.request(`/api/v1/tasks/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: "{}"
      })
    );
  }

  async auditPage(
    options: {
      invocationId?: string;
      limit?: number;
      cursor?: string;
      category?: AuditCategory;
    } = {}
  ): Promise<AuditPage> {
    const query = new URLSearchParams();
    if (options.invocationId) query.set("invocationId", options.invocationId);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.category) query.set("category", options.category);
    const suffix = query.size ? `?${query}` : "";
    return (await this.request(`/api/v1/audit${suffix}`)) as AuditPage;
  }

  async audit(invocationId?: string): Promise<unknown[]> {
    const page = await this.auditPage({ ...(invocationId ? { invocationId } : {}), limit: 100 });
    return page.events.slice().reverse();
  }

  async listApprovalsPage(
    options: {
      limit?: number;
      cursor?: string;
      status?: "pending" | "resolved";
    } = {}
  ): Promise<ApprovalPage> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.status) query.set("status", options.status);
    const suffix = query.size ? `?${query}` : "";
    return (await this.request(`/api/v1/approvals${suffix}`)) as ApprovalPage;
  }

  async listApprovals(): Promise<PendingApproval[]> {
    return (await this.listApprovalsPage()).approvals;
  }

  async resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<unknown> {
    return this.request(`/api/v1/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
  }

  async artifact(artifactId: string): Promise<Uint8Array> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
      { headers: this.headers() }
    );
    if (!response.ok) {
      throw new Error(`artifact download returned HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export interface PairedNode {
  nodeId: string;
  accountId: string;
}

export class NodeApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    readonly nodeId: string | undefined,
    private readonly privateKey: string,
    private readonly fetcher: Fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async pair(input: {
    code: string;
    label: string;
    platform: NodePlatform;
    publicKey: string;
  }): Promise<PairedNode> {
    const response = await this.fetcher(`${this.baseUrl}/api/v1/nodes/pair`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error((body as any)?.error?.message ?? "node pairing failed");
    }
    return body as PairedNode;
  }

  private async signedRequest(path: string, body: unknown): Promise<any> {
    if (!this.nodeId) {
      throw new Error("node is not paired");
    }
    const method = "POST";
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(18).toString("base64url");
    const signature = signNodeRequest(this.privateKey, {
      method,
      path,
      timestamp,
      nonce,
      body
    });
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-adc-node-id": this.nodeId,
        "x-adc-timestamp": timestamp,
        "x-adc-nonce": nonce,
        "x-adc-signature": signature
      },
      body: JSON.stringify(body)
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = ErrorSchema.safeParse((responseBody as any)?.error);
      throw new AdcClientError(
        response.status,
        parsed.success
          ? parsed.data
          : {
              code: "internal",
              message: `node API returned HTTP ${response.status}`,
              retryable: response.status >= 500
            }
      );
    }
    return responseBody;
  }

  async poll(
    capability: CapabilityAdvertisement,
    state: { activeTaskCount?: number; claim?: boolean } = {}
  ): Promise<NodePollResponse> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/poll`, {
      capability: CapabilitySchema.parse(capability),
      activeTaskCount: state.activeTaskCount ?? 0,
      claim: state.claim ?? true
    }) as Promise<NodePollResponse>;
  }

  async acknowledge(dispatchId: string, leaseToken: string): Promise<any> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/ack`, {
      dispatchId,
      leaseToken
    });
  }

  async renewLease(dispatchId: string, leaseToken: string): Promise<any> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/leases/renew`, {
      dispatchId,
      leaseToken
    });
  }

  async rotateKey(publicKey: string): Promise<any> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/rotate-key`, {
      publicKey
    });
  }

  async uploadArtifact(input: {
    dispatchId: string;
    artifactId: string;
    contentType: string;
    sha256: string;
    data: Buffer;
  }): Promise<any> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/artifacts`, {
      dispatchId: input.dispatchId,
      artifactId: input.artifactId,
      contentType: input.contentType,
      sha256: input.sha256,
      dataBase64: input.data.toString("base64")
    });
  }

  async complete(input: {
    dispatchId: string;
    leaseToken: string;
    result: InvocationResult;
  }): Promise<any> {
    return this.signedRequest(`/api/v1/nodes/${encodeURIComponent(this.nodeId!)}/receipts`, {
      dispatchId: input.dispatchId,
      leaseToken: input.leaseToken,
      result: ResultSchema.parse(input.result),
      ...(input.result.receipt ? { receipt: input.result.receipt } : {})
    });
  }
}
