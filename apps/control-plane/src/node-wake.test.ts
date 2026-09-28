import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { NodeWakeHub } from "./node-wake.ts";

class TestSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  readonly close = vi.fn((code?: number) => {
    this.readyState = WebSocket.CLOSING;
    this.emit("close", code);
  });
  readonly ping = vi.fn();
  readonly send = vi.fn((_data: string, callback?: (error?: Error) => void) => callback?.());
  readonly terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1006);
  });
}

describe("NodeWakeHub", () => {
  it("rejects a connection authenticated before credentials changed", () => {
    const hub = new NodeWakeHub({
      heartbeatIntervalMs: 60_000,
      touchPresence: async () => {}
    });
    const generation = hub.generation("node_example");
    hub.disconnect("node_example", "device key rotated");
    const socket = new TestSocket();

    expect(hub.connect("node_example", socket as unknown as WebSocket, generation)).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(4001, "device credentials changed");
    hub.close();
  });

  it("gives a new connection a full heartbeat interval to answer", () => {
    const hub = new NodeWakeHub({
      heartbeatIntervalMs: 60_000,
      touchPresence: async () => {}
    });
    const socket = new TestSocket();
    expect(hub.connect("node_example", socket as unknown as WebSocket)).toBe(true);

    const heartbeat = () =>
      (
        hub as unknown as {
          heartbeat(): void;
        }
      ).heartbeat();
    heartbeat();
    expect(socket.terminate).not.toHaveBeenCalled();
    heartbeat();
    expect(socket.terminate).toHaveBeenCalledOnce();
    hub.close();
  });
});
