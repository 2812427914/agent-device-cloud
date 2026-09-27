import { describe, expect, it } from "vitest";
import { AccessModeSchema, ConfigSchema, accessRoots, localFolder } from "./config.ts";

const legacy = {
  controlPlaneUrl: "http://localhost:8787",
  nodeId: "node_example",
  accountId: "acct_example",
  privateKey: "test-private",
  publicKey: "test-public",
  stateDirectory: "/test/state",
  roots: [{ rootId: "root_workspace", path: "/test/workspace", writable: true }]
};

describe("local access configuration", () => {
  it("preserves existing identity and folders when loading a legacy configuration", () => {
    expect(ConfigSchema.parse(legacy)).toMatchObject({ ...legacy, accessMode: "selected" });
  });

  it("supports pairing with no exposed folders", async () => {
    const config = ConfigSchema.parse({
      ...legacy,
      accessMode: "none",
      roots: await accessRoots("none")
    });
    expect(config.roots).toEqual([]);
    expect(() => ConfigSchema.parse({ ...legacy, accessMode: "none" })).toThrow();
  });

  it("uses explicit, distinct home and full-device scopes", async () => {
    expect(await accessRoots("full")).toEqual([
      {
        rootId: "root_device",
        path: "/",
        label: "All files",
        writable: true
      }
    ]);
    expect(await accessRoots("home", false)).toMatchObject([
      { rootId: "root_home", writable: false }
    ]);
    expect(() => AccessModeSchema.parse("unknown")).toThrow();
  });

  it("validates unique IDs, directories and transport without changing identity", async () => {
    expect(() =>
      ConfigSchema.parse({ ...legacy, roots: [...legacy.roots, ...legacy.roots] })
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({ ...legacy, controlPlaneUrl: "http://example.com" })
    ).toThrow();
    await expect(localFolder(import.meta.filename)).rejects.toThrow("folder");
    const root = await localFolder(process.cwd(), { label: "Work", writable: false });
    expect(root).toMatchObject({ label: "Work", writable: false });
    expect(root.rootId).toMatch(/^root_[a-f0-9]{16}$/);
  });

  it("accepts local stdio and secure HTTP MCP Providers without exposing them by default", () => {
    expect(ConfigSchema.parse(legacy).mcpProviders).toEqual([]);
    const config = ConfigSchema.parse({
      ...legacy,
      mcpProviders: [
        {
          providerId: "github",
          name: "GitHub",
          transport: "stdio",
          command: "npx",
          args: ["github-mcp"],
          env: { GITHUB_TOKEN: "local-only" }
        },
        {
          providerId: "internal",
          name: "Internal",
          transport: "http",
          url: "https://mcp.example.com/api",
          headers: { authorization: "Bearer local-only" }
        }
      ]
    });
    expect(config.mcpProviders).toHaveLength(2);
    expect(() =>
      ConfigSchema.parse({
        ...legacy,
        mcpProviders: [
          {
            providerId: "remote",
            name: "Remote",
            transport: "http",
            url: "http://mcp.example.com",
            headers: {}
          }
        ]
      })
    ).toThrow(/HTTPS/);
  });
});
