import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parseCorsOrigins, registerCors } from "./cors.ts";

describe("parseCorsOrigins", () => {
  it("returns undefined for empty input", () => {
    expect(parseCorsOrigins(undefined)).toBeUndefined();
    expect(parseCorsOrigins("")).toBeUndefined();
    expect(parseCorsOrigins("   ")).toBeUndefined();
  });

  it("supports the any-origin wildcard", () => {
    expect(parseCorsOrigins("*")).toBe("*");
  });

  it("parses a comma-separated allow-list and normalizes case", () => {
    expect(parseCorsOrigins("https://Workbench.Example, http://localhost:5173")).toEqual([
      "https://workbench.example",
      "http://localhost:5173"
    ]);
  });

  it("rejects entries that are not bare origins", () => {
    expect(() => parseCorsOrigins("devices.example.com")).toThrow(/invalid origin/);
    expect(() => parseCorsOrigins("https://example.com/path")).toThrow(/without a path/);
    expect(() => parseCorsOrigins("ftp://example.com")).toThrow(/without a path/);
  });
});

describe("registerCors", () => {
  async function server(origins: string[] | "*") {
    const app = Fastify();
    registerCors(app, { origins });
    app.get("/health", async () => ({ ok: true }));
    return app;
  }

  it("answers preflight requests from allowed origins", async () => {
    const app = await server(["https://workbench.example"]);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/nodes",
      headers: {
        origin: "https://workbench.example",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization"
      }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://workbench.example");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    await app.close();
  });

  it("ignores preflight from unlisted origins", async () => {
    const app = await server(["https://workbench.example"]);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/nodes",
      headers: { origin: "https://elsewhere.example", "access-control-request-method": "GET" }
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("reflects any origin in wildcard mode and tags responses with Vary", async () => {
    const app = await server("*");
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://any.example" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://any.example");
    expect(String(response.headers.vary)).toContain("Origin");
    await app.close();
  });

  it("leaves non-browser requests untouched", async () => {
    const app = await server(["https://workbench.example"]);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers.vary).toBeUndefined();
    await app.close();
  });

  it("does not advertise cross-origin cookie use", async () => {
    const app = await server(["https://workbench.example"]);
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://workbench.example" }
    });
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    await app.close();
  });
});
