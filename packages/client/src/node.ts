import { randomBytes } from "node:crypto";
import {
  CapabilitySchema,
  ErrorSchema,
  ResultSchema,
  type CapabilityAdvertisement,
  type InvocationResult,
  type NodePlatform,
  type ToolCapability
} from "@adc/protocol";
import { AdcClientError, type NodeDispatch, type NodePollResponse } from "./index.ts";

export { AdcClientError } from "./index.ts";
export type { NodeDispatch, NodePollResponse } from "./index.ts";
import { signNodeRequest } from "./node-auth.ts";

export * from "./node-auth.ts";

type Fetch = typeof globalThis.fetch;

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
