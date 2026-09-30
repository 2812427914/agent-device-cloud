import { createHash } from "node:crypto";
import { AdcClientError, NodeApiClient, type NodeDispatch } from "@adc/client";
import {
  CapabilitySchema,
  ToolNameSchema,
  absolutePathForToolArgs,
  rootForAbsolutePath,
  type CapabilityAdvertisement,
  type NodePlatform
} from "@adc/protocol";
import { ToolRuntime, type CommandTemplate, type LocalRoot } from "@adc/tool-runtime";
import type { McpProviderConfig } from "./config.ts";
import { McpProviderManager } from "./mcp-providers.ts";
import { nodePlatform } from "./platform.ts";
import { WakeLatch, WebSocketWakeSource, type NodeWakeSource } from "./wake.ts";

const DEFAULT_MAX_CONCURRENCY = 6;
const MAX_MAX_CONCURRENCY = 32;

interface LocalAccess {
  roots: LocalRoot[];
  templates?: CommandTemplate[];
  accessMode?: "none" | "selected" | "home" | "full";
  mcpProviders?: McpProviderConfig[];
}

function normalizeAccess(access: LocalAccess): Required<LocalAccess> {
  return {
    roots: access.roots,
    templates: access.templates ?? [],
    accessMode: access.accessMode ?? "selected",
    mcpProviders: access.mcpProviders ?? []
  };
}

function accessFingerprint(access: LocalAccess): string {
  return JSON.stringify(normalizeAccess(access));
}

export interface NodeDaemonOptions {
  controlPlaneUrl: string;
  nodeId: string;
  privateKey: string;
  roots: LocalRoot[];
  templates?: CommandTemplate[];
  stateDirectory: string;
  nodeVersion?: string;
  platform?: NodePlatform;
  pollIntervalMs?: number;
  leaseRenewIntervalMs?: number;
  fetcher?: typeof fetch;
  accessMode?: LocalAccess["accessMode"];
  loadAccess?: () => Promise<LocalAccess>;
  configReloadIntervalMs?: number;
  mcpProviders?: McpProviderConfig[];
  mcpProviderManager?: McpProviderManager;
  wakeSource?: NodeWakeSource;
}

export class NodeDaemon {
  readonly api: NodeApiClient;
  readonly runtime: ToolRuntime;
  readonly providers: McpProviderManager;
  private readonly shutdown = new AbortController();
  private readonly wakeSource: NodeWakeSource;
  private access: LocalAccess;
  private accessInitialized = false;
  private reloadQueue: Promise<boolean> = Promise.resolve(false);
  private maxConcurrency = DEFAULT_MAX_CONCURRENCY;

  constructor(private readonly options: NodeDaemonOptions) {
    this.access = normalizeAccess({
      roots: options.roots,
      ...(options.templates ? { templates: options.templates } : {}),
      ...(options.accessMode ? { accessMode: options.accessMode } : {}),
      ...(options.mcpProviders ? { mcpProviders: options.mcpProviders } : {})
    });
    this.providers = options.mcpProviderManager ?? new McpProviderManager();
    this.api = options.fetcher
      ? new NodeApiClient(
          options.controlPlaneUrl,
          options.nodeId,
          options.privateKey,
          options.fetcher
        )
      : new NodeApiClient(options.controlPlaneUrl, options.nodeId, options.privateKey);
    this.wakeSource =
      options.wakeSource ??
      new WebSocketWakeSource({
        controlPlaneUrl: options.controlPlaneUrl,
        nodeId: options.nodeId,
        privateKey: options.privateKey,
        onError: (error) => {
          console.error(
            JSON.stringify({
              level: "warn",
              component: "adc-node",
              message: "wake connection failed",
              error: error instanceof Error ? error.message : String(error)
            })
          );
        }
      });
    this.runtime = new ToolRuntime({
      nodeId: options.nodeId,
      roots: options.roots,
      stateDirectory: options.stateDirectory,
      fullTrust: options.accessMode === "full",
      externalExecutor: this.providers.execute,
      ...(options.templates ? { templates: options.templates } : {})
    });
  }

  private reloadAccess(): Promise<boolean> {
    this.reloadQueue = this.reloadQueue
      .catch(() => false)
      .then(async () => {
        const next = normalizeAccess(
          this.options.loadAccess ? await this.options.loadAccess() : this.access
        );
        const changed = accessFingerprint(next) !== accessFingerprint(this.access);
        const providersBefore = JSON.stringify(this.providers.capabilities());
        await this.providers.update(next.mcpProviders);
        const providersChanged = providersBefore !== JSON.stringify(this.providers.capabilities());
        if (!this.accessInitialized || changed) {
          this.runtime.updateAccess(next.roots, next.templates, next.accessMode === "full");
        }
        this.access = next;
        this.accessInitialized = true;
        return changed || providersChanged;
      });
    return this.reloadQueue;
  }

  private async waitForWork(
    wake: WakeLatch,
    maximumDelayMs: number,
    signal: AbortSignal
  ): Promise<void> {
    const deadline = Date.now() + maximumDelayMs;
    do {
      const remaining = Math.max(0, deadline - Date.now());
      const delay = this.options.loadAccess
        ? Math.min(this.options.configReloadIntervalMs ?? 1_000, remaining)
        : remaining;
      if (await wake.wait(delay, signal)) return;
      if (signal.aborted || Date.now() >= deadline) return;
      if (this.options.loadAccess && (await this.reloadAccess())) return;
    } while (!signal.aborted);
  }

  capability(now = new Date()): CapabilityAdvertisement {
    const platform = this.options.platform ?? nodePlatform();
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
        ...(platform === "win32" ? {} : { path: root.path }),
        label: root.label ?? root.rootId,
        writable: root.writable
      })),
      platform,
      nodeVersion: this.options.nodeVersion ?? "0.1.0",
      advertisedAt: now.toISOString()
    });
  }

  private async pollForDispatch(
    activeTaskCount: number,
    claim: boolean
  ): Promise<NodeDispatch | undefined> {
    await this.reloadAccess();
    const response = await this.api.poll(this.capability(), { activeTaskCount, claim });
    const configuredConcurrency = response.maxConcurrency;
    if (
      typeof configuredConcurrency === "number" &&
      Number.isInteger(configuredConcurrency) &&
      configuredConcurrency >= 1 &&
      configuredConcurrency <= MAX_MAX_CONCURRENCY
    ) {
      this.maxConcurrency = configuredConcurrency;
    }
    return response.dispatch ?? undefined;
  }

  private async executeDispatch(dispatch: NodeDispatch, lifecycle: AbortSignal): Promise<void> {
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
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const lifecycle = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    if (lifecycle.aborted) return false;
    const dispatch = await this.pollForDispatch(0, true);
    if (!dispatch) return false;
    await this.executeDispatch(dispatch, lifecycle);
    return true;
  }

  async run(signal?: AbortSignal): Promise<void> {
    const lifecycle = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    const wake = new WakeLatch();
    const wakeTask = this.wakeSource
      .run(() => wake.notify(), lifecycle)
      .catch((error) => {
        console.error(
          JSON.stringify({
            level: "error",
            component: "adc-node",
            message: "wake listener stopped",
            error: error instanceof Error ? error.message : String(error)
          })
        );
      });
    const active = new Set<Promise<void>>();
    const start = (dispatch: NodeDispatch) => {
      const task = this.executeDispatch(dispatch, lifecycle).catch((error) => {
        console.error(
          JSON.stringify({
            level: "error",
            component: "adc-node",
            message: "task execution failed",
            dispatchId: dispatch.dispatchId,
            error: error instanceof Error ? error.message : String(error)
          })
        );
      });
      active.add(task);
      void task.finally(() => {
        active.delete(task);
        wake.notify();
      });
    };
    let errorDelay = 1_000;
    try {
      while (!lifecycle.aborted) {
        try {
          const claim = active.size < this.maxConcurrency;
          const dispatch = await this.pollForDispatch(active.size, claim);
          errorDelay = 1_000;
          if (dispatch) {
            start(dispatch);
            continue;
          }
          // A settings-only poll can raise the limit while all known slots are occupied.
          if (!claim && active.size < this.maxConcurrency) continue;
          await this.waitForWork(wake, this.options.pollIntervalMs ?? 30_000, lifecycle);
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              component: "adc-node",
              message: error instanceof Error ? error.message : String(error)
            })
          );
          await wake.wait(errorDelay, lifecycle);
          errorDelay = Math.min(errorDelay * 2, 30_000);
        }
      }
    } finally {
      await wakeTask;
      await Promise.allSettled([...active]);
      await this.providers.close();
    }
  }

  stop(): void {
    this.shutdown.abort();
  }
}
