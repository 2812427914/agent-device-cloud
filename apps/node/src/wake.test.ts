import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { generateNodeKeyPair, verifyNodeRequest } from "@adc/client";
import { NodeWakeSignalSchema } from "@adc/protocol";
import { WebSocketServer } from "ws";
import { WebSocketWakeSource } from "./wake.ts";

const servers: Array<{ http: ReturnType<typeof createServer>; websocket: WebSocketServer }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ http, websocket }) =>
        new Promise<void>((resolve) => {
          websocket.close(() => http.close(() => resolve()));
          for (const client of websocket.clients) client.terminate();
        })
    )
  );
});

describe("WebSocketWakeSource", () => {
  it("authenticates the outbound connection and accepts a wake signal", async () => {
    const keys = generateNodeKeyPair();
    const nodeId = "node_example";
    const path = `/api/v1/nodes/${nodeId}/events`;
    const http = createServer();
    const websocket = new WebSocketServer({ server: http });
    servers.push({ http, websocket });
    let authenticated = false;

    websocket.on("connection", (socket, request) => {
      const timestamp = String(request.headers["x-adc-timestamp"]);
      const nonce = String(request.headers["x-adc-nonce"]);
      authenticated = verifyNodeRequest(
        keys.publicKey,
        String(request.headers["x-adc-signature"]),
        {
          method: "GET",
          path,
          timestamp,
          nonce
        }
      );
      socket.send(
        JSON.stringify(
          NodeWakeSignalSchema.parse({
            schemaVersion: "0.1",
            type: "dispatch.available",
            nodeId,
            issuedAt: new Date().toISOString()
          })
        )
      );
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("test server did not listen");

    const controller = new AbortController();
    let wakeCount = 0;
    const source = new WebSocketWakeSource({
      controlPlaneUrl: `http://127.0.0.1:${address.port}`,
      nodeId,
      privateKey: keys.privateKey,
      reconnectInitialMs: 5,
      reconnectMaximumMs: 5,
      random: () => 0.5
    });
    const running = source.run(() => {
      wakeCount += 1;
      if (wakeCount === 2) controller.abort();
    }, controller.signal);

    await running;
    expect(authenticated).toBe(true);
    expect(wakeCount).toBe(2);
  });

  it("reconnects after the server closes the wake connection", async () => {
    const keys = generateNodeKeyPair();
    const http = createServer();
    const websocket = new WebSocketServer({ server: http });
    servers.push({ http, websocket });
    const connectedAt: number[] = [];

    websocket.on("connection", (socket) => {
      connectedAt.push(Date.now());
      if (connectedAt.length < 3) socket.close(1012, "service restart");
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("test server did not listen");

    const controller = new AbortController();
    const source = new WebSocketWakeSource({
      controlPlaneUrl: `http://127.0.0.1:${address.port}`,
      nodeId: "node_example",
      privateKey: keys.privateKey,
      reconnectInitialMs: 20,
      reconnectMaximumMs: 80,
      stableConnectionMs: 1_000,
      random: () => 0.5
    });
    const running = source.run(() => {
      if (connectedAt.length === 3) controller.abort();
    }, controller.signal);

    await running;
    expect(connectedAt).toHaveLength(3);
    expect(connectedAt[2]! - connectedAt[1]!).toBeGreaterThanOrEqual(30);
  });

  it("reconnects when an open connection stops receiving server activity", async () => {
    const keys = generateNodeKeyPair();
    const http = createServer();
    const websocket = new WebSocketServer({ server: http });
    servers.push({ http, websocket });
    let connectionCount = 0;

    websocket.on("connection", () => {
      connectionCount += 1;
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("test server did not listen");

    const controller = new AbortController();
    const source = new WebSocketWakeSource({
      controlPlaneUrl: `http://127.0.0.1:${address.port}`,
      nodeId: "node_example",
      privateKey: keys.privateKey,
      reconnectInitialMs: 5,
      reconnectMaximumMs: 5,
      heartbeatTimeoutMs: 10,
      stableConnectionMs: 100,
      random: () => 0.5
    });
    const running = source.run(() => {
      if (connectionCount === 2) controller.abort();
    }, controller.signal);

    await running;
    expect(connectionCount).toBe(2);
  });
});
