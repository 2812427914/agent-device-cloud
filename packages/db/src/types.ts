import type {
  CapabilityAdvertisement,
  Invocation,
  InvocationResult,
  PolicyDecision,
  Receipt,
  ToolId
} from "@adc/protocol";

export interface AccountRecord {
  accountId: string;
  ownerTokenHash: string;
  createdAt: string;
}

export interface PairingCodeRecord {
  codeHash: string;
  accountId: string;
  expiresAt: string;
  usedAt?: string;
}

export interface NodeRecord {
  nodeId: string;
  accountId: string;
  label: string;
  publicKey: string;
  platform: "darwin" | "linux";
  status: "active" | "revoked";
  accessPolicy?: NodeAccessPolicy;
  revision?: number;
  deletedAt?: string;
  capability?: CapabilityAdvertisement;
  lastSeenAt?: string;
  createdAt: string;
}

export interface NodeAccessPolicy {
  rootAccess: "all" | "selected";
  rootIds: string[];
  readOnlyRootIds: string[];
  allowExecution: boolean;
}

export interface ProjectRecord {
  projectId: string;
  accountId: string;
  label: string;
  createdAt: string;
}

export interface RootBindingRecord {
  rootId: string;
  projectId: string;
  nodeId: string;
  label: string;
  writable: boolean;
  createdAt: string;
}

export interface AgentGrantRecord {
  grantId: string;
  accountId: string;
  name?: string;
  projectId?: string;
  actorId: string;
  profile: "read-only" | "workspace-write" | "approve-required" | "unattended";
  nodeIds: string[];
  rootIds: string[];
  rootAccess?: "selected" | "all";
  approvalPolicy?: "never" | "writes" | "execute" | "always";
  allowedTools: ToolId[];
  revokedAt?: string;
  deletedAt?: string;
  revision?: number;
  createdAt: string;
}

export type DispatchStatus =
  | "queued"
  | "leased"
  | "running"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "denied"
  | "cancelled"
  | "unknown_outcome";

export interface DispatchRecord {
  dispatchId: string;
  invocation: Invocation;
  nodeId: string;
  policyDecision: PolicyDecision;
  status: DispatchStatus;
  leaseToken?: string;
  leaseExpiresAt?: string;
  result?: InvocationResult;
  receipt?: Receipt;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  eventId: string;
  accountId: string;
  invocationId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ArtifactRecord {
  artifactId: string;
  accountId: string;
  invocationId: string;
  nodeId: string;
  contentType: string;
  sha256: string;
  data: Buffer;
  createdAt: string;
}

export interface ApprovalRecord {
  approvalId: string;
  accountId: string;
  invocation: Invocation;
  nodeId: string;
  placementReason: string;
  policyDecision: PolicyDecision;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
}

export interface PairNodeInput {
  codeHash: string;
  node: Omit<NodeRecord, "accountId"> & { accountId?: string };
  now: Date;
}

export interface PairNodeResult {
  node: NodeRecord;
  replacedNodeIds: string[];
}

export interface Store {
  migrate(): Promise<void>;
  close(): Promise<void>;
  putAccount(account: AccountRecord): Promise<void>;
  getAccount(accountId: string): Promise<AccountRecord | undefined>;
  putPairingCode(code: PairingCodeRecord): Promise<void>;
  pairNode(input: PairNodeInput): Promise<PairNodeResult | undefined>;
  getNode(nodeId: string): Promise<NodeRecord | undefined>;
  listNodes(accountId: string): Promise<NodeRecord[]>;
  updateNodePresence(
    nodeId: string,
    capability: CapabilityAdvertisement,
    now: Date
  ): Promise<NodeRecord | undefined>;
  touchNodePresences(nodeIds: string[], now: Date): Promise<void>;
  rotateNodeKey(nodeId: string, publicKey: string, now: Date): Promise<boolean>;
  revokeNode(nodeId: string, now: Date): Promise<boolean>;
  updateNode(
    accountId: string,
    nodeId: string,
    changes: Pick<NodeRecord, "label" | "accessPolicy">,
    revision: number,
    audit: AuditEvent
  ): Promise<NodeRecord>;
  deleteNode(accountId: string, nodeId: string, revision: number, audit: AuditEvent): Promise<void>;
  putProject(project: ProjectRecord): Promise<void>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  listProjects(accountId: string): Promise<ProjectRecord[]>;
  putRoot(root: RootBindingRecord): Promise<void>;
  listRoots(projectId: string): Promise<RootBindingRecord[]>;
  putGrant(grant: AgentGrantRecord, createOnly?: boolean): Promise<void>;
  updateGrant(
    grant: AgentGrantRecord,
    revision: number,
    audit: AuditEvent
  ): Promise<AgentGrantRecord>;
  deleteGrant(
    accountId: string,
    grantId: string,
    revision: number,
    audit: AuditEvent
  ): Promise<void>;
  getGrant(grantId: string): Promise<AgentGrantRecord | undefined>;
  listGrants(accountId: string): Promise<AgentGrantRecord[]>;
  revokeGrant(accountId: string, grantId: string, now: Date): Promise<boolean>;
  putApproval(approval: ApprovalRecord): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | undefined>;
  listApprovals(accountId: string): Promise<ApprovalRecord[]>;
  resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
    now: Date
  ): Promise<ApprovalRecord | undefined>;
  approveAndEnqueue(
    approvalId: string,
    dispatch: DispatchRecord,
    audit: AuditEvent,
    now: Date
  ): Promise<DispatchRecord | undefined>;
  enqueue(dispatch: DispatchRecord, audit: AuditEvent): Promise<DispatchRecord>;
  claim(nodeId: string, now: Date, leaseMs: number): Promise<DispatchRecord | undefined>;
  acknowledge(
    dispatchId: string,
    leaseToken: string,
    now: Date
  ): Promise<DispatchRecord | undefined>;
  renewLease(
    dispatchId: string,
    leaseToken: string,
    now: Date,
    leaseMs: number
  ): Promise<DispatchRecord | undefined>;
  complete(
    dispatchId: string,
    leaseToken: string,
    result: InvocationResult,
    receipt: Receipt | undefined,
    now: Date
  ): Promise<DispatchRecord | undefined>;
  requestCancel(dispatchId: string, now: Date): Promise<DispatchRecord | undefined>;
  getDispatchById(dispatchId: string): Promise<DispatchRecord | undefined>;
  getDispatchByInvocation(invocationId: string): Promise<DispatchRecord | undefined>;
  listAudit(accountId: string, invocationId?: string): Promise<AuditEvent[]>;
  putAudit(event: AuditEvent): Promise<void>;
  putArtifact(artifact: ArtifactRecord): Promise<void>;
  getArtifact(artifactId: string): Promise<ArtifactRecord | undefined>;
  consumeNodeNonce(nodeId: string, nonce: string, expiresAt: Date): Promise<boolean>;
}
