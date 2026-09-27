import { createHash } from "node:crypto";
import { AdcClientError, NodeApiClient } from "@adc/client";
import {
  CapabilitySchema,
  ToolNameSchema,
  absolutePathForToolArgs,
  rootForAbsolutePath,
  type CapabilityAdvertisement
} from "@adc/protocol";
import { ToolRuntime, type CommandTemplate, type LocalRoot } from "@adc/tool-runtime";
import type { McpProviderConfig } from "./config.ts";
import { McpProviderManager } from "./mcp-providers.ts";

interface LocalAccess {
  roots: LocalRoot[];
  templates?: CommandTemplate[];
  accessMode?: "none" | "selected" | "home" | "full";
  mcpProviders?: McpProviderConfig[];
}

export interface NodeDaemonOptions {
  controlPlaneUrl: string;
  nodeId: string;
  privateKey: string;
  roots: LocalRoot[];
  templates?: CommandTemplate[];
  stateDirectory: string;
  nodeVersion?: string;
  pollIntervalMs?: number;
  leaseRenewIntervalMs?: number;
  fetcher?: typeof fetch;
  accessMode?: LocalAccess["accessMode"];
  loadAccess?: () => Promise<LocalAccess>;
  configReloadIntervalMs?: number;
  mcpProviders?: McpProviderConfig[];
  mcpProviderManager?: McpProviderManager;
}

export class NodeDaemon {
  readonly api: NodeApiClient;
  readonly runtime: ToolRuntime;
  readonly providers: McpProviderManager;
  private readonly shutdown = new AbortController();
  private access: LocalAccess;
  private reloadQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: NodeDaemonOptions) {
    this.access = {
      roots: options.roots,
      templates: options.templates ?? [],
      accessMode: options.accessMode ?? "selected",
      mcpProviders: options.mcpProviders ?? []
    };
    this.providers = options.mcpProviderManager ?? new McpProviderManager();
    this.api = options.fetcher
      ? new NodeApiClient(
          options.controlPlaneUrl,
          options.nodeId,
          options.privateKey,
          options.fetcher
        )
      : new NodeApiClient(options.controlPlaneUrl, options.nodeId, options.privateKey);
    this.runtime = new ToolRuntime({
      nodeId: options.nodeId,
      roots: options.roots,
      stateDirectory: options.stateDirectory,
      fullTrust: options.accessMode === "full",
      externalExecutor: this.providers.execute,
      ...(options.templates ? { templates: options.templates } : {})
    });
  }

  private reloadAccess(): Promise<void> {
    this.reloadQueue = this.reloadQueue
      .catch(() => {})
      .then(async () => {
        const next = this.options.loadAccess ? await this.options.loadAccess() : this.access;
        await this.providers.update(next.mcpProviders ?? []);
        this.runtime.updateAccess(next.roots, next.templates ?? [], next.accessMode === "full");
        this.access = next;
      });
    return this.reloadQueue;
  }

  capability(now = new Date()): CapabilityAdvertisement {
    return CapabilitySchema.parse({
      schemaVersion: "0.1",
      nodeId: this.options.nodeId,
      tools: [
        ...ToolNameSchema.options
          .filter(
            (name) =>
              ![
                "device.list",
                "device.status",
                "task.status",
                "task.result",
                "task.cancel"
              ].includes(name)
          )
          .map((name) => ({
            name,
            version: "0.1.0",
            risk:
              name.startsWith("file.") && !["file.write", "file.edit", "file.patch"].includes(name)
                ? ("read" as const)
                : name === "command.template.list"
                  ? ("read" as const)
                  : name === "file.write" || name === "file.edit" || name === "file.patch"
                    ? ("write" as const)
                    : ("execute" as const),
            sandboxProfiles: [
              this.access.accessMode === "full"
                ? ("full-trust" as const)
                : ("restricted-process" as const)
            ]
          })),
        ...this.providers.capabilities()
      ],
      accessMode: this.access.accessMode ?? "selected",
      roots: this.access.roots.map((root) => ({
        rootId: root.rootId,
        path: root.path,
        label: root.label ?? root.rootId,
        writable: root.writable
      })),
      platform: process.platform,
      nodeVersion: this.options.nodeVersion ?? "0.1.0",
      advertisedAt: now.toISOString()
    });
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const lifecycle = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    if (lifecycle.aborted) return false;
    await this.reloadAccess();
    const response = await this.api.poll(this.capability());
    const dispatch = response.dispatch;
    if (!dispatch) {
      return false;
    }
    const acknowledged = await this.api.acknowledge(dispatch.dispatchId, dispatch.leaseToken);
    let reloadFailed = false;
    try {
      await this.reloadAccess();
    } catch {
      reloadFailed = true;
    }
    const cancellation = new AbortController();
    const onStop = () => cancellation.abort();
    lifecycle.addEventListener("abort", onStop, { once: true });
    if (lifecycle.aborted || acknowledged.cancelRequested || reloadFailed) cancellation.abort();
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const armLeaseDeadline = (expiresAt: string) => {
      if (finished) return;
      if (leaseTimer) clearTimeout(leaseTimer);
      const remaining = Date.parse(expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        cancellation.abort();
        return;
      }
      leaseTimer = setTimeout(() => cancellation.abort(), remaining);
      leaseTimer.unref();
    };
    armLeaseDeadline(acknowledged.leaseExpiresAt);
    let renewInFlight = false;
    const renewTimer = setInterval(
      () => {
        if (renewInFlight) return;
        renewInFlight = true;
        void this.api
          .renewLease(dispatch.dispatchId, dispatch.leaseToken)
          .then((renewed) => {
            armLeaseDeadline(renewed.leaseExpiresAt);
            if (renewed.cancelRequested) {
              cancellation.abort();
            }
          })
          .catch((error) => {
            if (error instanceof AdcClientError && [401, 403, 409].includes(error.statusCode)) {
              cancellation.abort();
            }
            console.error(
              JSON.stringify({
                level: "warn",
                component: "adc-node",
                message: "lease renewal failed",
                error: error instanceof Error ? error.message : String(error)
              })
            );
          })
          .finally(() => {
            renewInFlight = false;
          });
      },
      Math.max(
        1,
        Math.min(
          this.options.leaseRenewIntervalMs ?? 10_000,
          Math.floor((Date.parse(acknowledged.leaseExpiresAt) - Date.now()) / 3) || 1
        )
      )
    );
    renewTimer.unref();
    const accessAtStart = this.access;
    const invocationArgs = dispatch.invocation.args as Record<string, unknown>;
    const absolutePath = absolutePathForToolArgs(dispatch.invocation.tool, invocationArgs);
    const rootId =
      (typeof invocationArgs.rootId === "string" ? invocationArgs.rootId : undefined) ??
      (absolutePath ? rootForAbsolutePath(absolutePath, accessAtStart.roots)?.rootId : undefined);
    let reloadInFlight = false;
    const configTimer = this.options.loadAccess
      ? setInterval(() => {
          if (reloadInFlight) return;
          reloadInFlight = true;
          void this.reloadAccess()
            .then(() => {
              const before = accessAtStart.roots.find((root) => root.rootId === rootId);
              const after = this.access.roots.find((root) => root.rootId === rootId);
              if (
                (before &&
                  (!after || before.path !== after.path || (before.writable && !after.writable))) ||
                (accessAtStart.accessMode === "full" && this.access.accessMode !== "full") ||
                JSON.stringify(accessAtStart.templates) !== JSON.stringify(this.access.templates) ||
                JSON.stringify(accessAtStart.mcpProviders) !==
                  JSON.stringify(this.access.mcpProviders)
              )
                cancellation.abort();
            })
            .catch(() => cancellation.abort())
            .finally(() => {
              reloadInFlight = false;
            });
        }, this.options.configReloadIntervalMs ?? 1000)
      : undefined;
    configTimer?.unref();
    try {
      const result = await this.runtime.execute(
        dispatch.invocation,
        dispatch.policyDecision,
        cancellation.signal
      );
      for (const artifactId of result.receipt?.artifactRefs ?? []) {
        const data = await this.runtime.readArtifact(artifactId);
        await this.api.uploadArtifact({
          dispatchId: dispatch.dispatchId,
          artifactId,
          contentType: "text/plain; charset=utf-8",
          sha256: `sha256:${createHash("sha256").update(data).digest("hex")}`,
          data
        });
      }
      await this.api.complete({
        dispatchId: dispatch.dispatchId,
        leaseToken: dispatch.leaseToken,
        result
      });
    } finally {
      finished = true;
      clearInterval(renewTimer);
      if (configTimer) clearInterval(configTimer);
      if (leaseTimer) clearTimeout(leaseTimer);
      lifecycle.removeEventListener("abort", onStop);
    }
    return true;
  }

  async run(signal?: AbortSignal): Promise<void> {
    const lifecycle = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    let delay = this.options.pollIntervalMs ?? 1000;
    try {
      while (!lifecycle.aborted) {
        try {
          const handled = await this.runOnce(lifecycle);
          delay = handled ? 0 : (this.options.pollIntervalMs ?? 1000);
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              component: "adc-node",
              message: error instanceof Error ? error.message : String(error)
            })
          );
          delay = Math.min(Math.max(delay * 2, 1000), 30_000);
        }
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              lifecycle.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, delay);
            lifecycle.addEventListener("abort", finish, { once: true });
            if (lifecycle.aborted) finish();
          });
        }
      }
    } finally {
      await this.providers.close();
    }
  }

  stop(): void {
    this.shutdown.abort();
  }
}
