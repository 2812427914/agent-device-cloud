import { randomBytes } from "node:crypto";
import { signNodeRequest } from "@adc/client";
import { NodeWakeSignalSchema } from "@adc/protocol";
import WebSocket from "ws";

export class WakeLatch {
  private pending = false;
  private waiter: (() => void) | undefined;

  notify(): void {
    if (!this.waiter) {
      this.pending = true;
      return;
    }
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter();
  }

  wait(delayMs: number, signal: AbortSignal): Promise<boolean> {
    if (this.pending) {
      this.pending = false;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const finish = (woken: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (this.waiter === wake) this.waiter = undefined;
        resolve(woken);
      };
      const wake = () => finish(true);
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), delayMs);
      this.waiter = wake;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}

export interface NodeWakeSource {
  readonly connected: boolean;
  run(onWake: () => void, signal: AbortSignal): Promise<void>;
}

export interface WebSocketWakeSourceOptions {
  controlPlaneUrl: string;
  nodeId: string;
  privateKey: string;
  reconnectInitialMs?: number;
  reconnectMaximumMs?: number;
  handshakeTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  stableConnectionMs?: number;
  random?: () => number;
  onError?: (error: unknown) => void;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export class WebSocketWakeSource implements NodeWakeSource {
  private socket: WebSocket | undefined;

  constructor(private readonly options: WebSocketWakeSourceOptions) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async run(onWake: () => void, signal: AbortSignal): Promise<void> {
    const initialDelay = this.options.reconnectInitialMs ?? 1_000;
    const maximumDelay = this.options.reconnectMaximumMs ?? 30_000;
    const random = this.options.random ?? Math.random;
    let reconnectDelay = initialDelay;

    while (!signal.aborted) {
      let stable = false;
      try {
        stable = await this.connect(onWake, signal);
      } catch (error) {
        this.options.onError?.(error);
      }
      if (signal.aborted) break;
      const delay = stable ? initialDelay : reconnectDelay;
      reconnectDelay = stable
        ? initialDelay
        : Math.min(Math.max(reconnectDelay * 2, initialDelay), maximumDelay);
      await wait(delay * (0.8 + random() * 0.4), signal);
    }
  }

  private connect(onWake: () => void, signal: AbortSignal): Promise<boolean> {
    const path = `/api/v1/nodes/${encodeURIComponent(this.options.nodeId)}/events`;
    const url = new URL(this.options.controlPlaneUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
    url.search = "";
    url.hash = "";

    const timestamp = new Date().toISOString();
    const nonce = randomBytes(18).toString("base64url");
    const signature = signNodeRequest(this.options.privateKey, {
      method: "GET",
      path,
      timestamp,
      nonce
    });
    const socket = new WebSocket(url, {
      followRedirects: false,
      handshakeTimeout: this.options.handshakeTimeoutMs ?? 15_000,
      maxPayload: 1024,
      headers: {
        "x-adc-node-id": this.options.nodeId,
        "x-adc-timestamp": timestamp,
        "x-adc-nonce": nonce,
        "x-adc-signature": signature
      }
    });

    return new Promise((resolve) => {
      let openedAt: number | undefined;
      let finished = false;
      let activityTimer: NodeJS.Timeout | undefined;
      const armActivityTimeout = () => {
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          this.options.onError?.(new Error("wake connection heartbeat timed out"));
          socket.terminate();
        }, this.options.heartbeatTimeoutMs ?? 75_000);
        activityTimer.unref();
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        if (activityTimer) clearTimeout(activityTimer);
        signal.removeEventListener("abort", abort);
        if (this.socket === socket) this.socket = undefined;
        resolve(
          openedAt !== undefined &&
            Date.now() - openedAt >= (this.options.stableConnectionMs ?? 60_000)
        );
      };
      const abort = () => socket.terminate();

      socket.once("open", () => {
        openedAt = Date.now();
        this.socket = socket;
        armActivityTimeout();
        onWake();
      });
      socket.on("ping", armActivityTimeout);
      socket.on("message", (data) => {
        armActivityTimeout();
        try {
          const event = NodeWakeSignalSchema.parse(JSON.parse(data.toString()));
          if (event.nodeId === this.options.nodeId) onWake();
        } catch (error) {
          this.options.onError?.(error);
          socket.close(1008, "invalid wake signal");
        }
      });
      socket.once("error", (error) => {
        if (!signal.aborted) this.options.onError?.(error);
      });
      socket.once("close", finish);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
