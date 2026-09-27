import { describe, expect, it } from "vitest";
import { buildInvocation, defaultTarget, type InvocationContext } from "./index.ts";

const context: InvocationContext = {
  accountId: "acct_example",
  actorId: "actor_example",
  grantId: "grant_example",
  nodeIds: ["node_example"],
  resourcesByNode: {
    node_example: [{ rootId: "root_workspace", path: "/Users/example/workspace" }]
  },
  rootIds: ["root_workspace"]
};

describe("device invocation context", () => {
  it("uses a single device without a project", () => {
    expect(
      buildInvocation({
        context,
        tool: "file.read",
        args: { rootId: "root_workspace", path: "hello.txt" },
        source: "sdk"
      })
    ).toMatchObject({ target: { nodeId: "node_example" } });
  });

  it("requires explicit placement for multiple devices but allows discovery", () => {
    const multiple = { ...context, nodeIds: ["node_first", "node_second"] };
    expect(() => defaultTarget(multiple, "file.read")).toThrow("Multiple devices");
    expect(defaultTarget(multiple, "device.list")).toEqual({ nodeId: "node_first" });
    expect(() => defaultTarget({ ...context, nodeIds: [] })).toThrow("No device");
  });

  it("retains project placement for existing grants", () => {
    expect(defaultTarget({ ...context, projectId: "proj_example" })).toEqual({
      projectId: "proj_example"
    });
  });

  it("maps an absolute path to its device root without exposing the root ID in args", () => {
    const built = buildInvocation({
      context: { ...context, projectId: "proj_example" },
      tool: "file.read",
      args: { path: "/Users/example/workspace/hello.txt" },
      source: "sdk"
    });
    expect(built).toMatchObject({
      target: { nodeId: "node_example" },
      args: { path: "/Users/example/workspace/hello.txt" },
      authorization: { rootIds: ["root_workspace"] }
    });
    expect(built.args).not.toHaveProperty("rootId");
  });

  it("requires a node and an authorized mapping for absolute paths", () => {
    expect(() =>
      buildInvocation({
        context: { ...context, nodeIds: ["node_example", "node_other"] },
        tool: "file.read",
        args: { path: "/Users/example/workspace/hello.txt" },
        source: "sdk"
      })
    ).toThrow("target.nodeId");
    expect(() =>
      buildInvocation({
        context,
        tool: "file.read",
        args: { path: "/private/secret.txt" },
        source: "sdk"
      })
    ).toThrow("outside");
  });

  it("includes new roots only for an explicitly all-roots context", () => {
    const input = {
      tool: "file.read",
      args: { rootId: "root_added", path: "hello.txt" },
      source: "sdk" as const
    };
    expect(buildInvocation({ ...input, context }).authorization.rootIds).toEqual([
      "root_workspace"
    ]);
    expect(
      buildInvocation({ ...input, context: { ...context, rootAccess: "all" } }).authorization
        .rootIds
    ).toEqual(["root_added"]);
  });

  it("limits discovery authorization to the selected device in large device networks", () => {
    const roots = Array.from({ length: 64 }, (_, index) => `root_folder${index}`);
    expect(
      buildInvocation({
        context: {
          ...context,
          rootAccess: "all",
          rootIds: [...roots, "root_other"],
          rootsByNode: { node_example: roots }
        },
        tool: "command.template.list",
        args: {},
        source: "sdk"
      }).authorization.rootIds
    ).toHaveLength(64);
  });

  it("requires idempotency for device writes", () => {
    expect(() =>
      buildInvocation({
        context,
        tool: "file.write",
        args: { rootId: "root_workspace", path: "hello.txt", content: "once" },
        source: "cli"
      })
    ).toThrow("idempotencyKey");
  });
});
