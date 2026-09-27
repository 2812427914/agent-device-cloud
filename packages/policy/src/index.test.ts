import { describe, expect, it } from "vitest";
import { InvocationSchema, type Invocation } from "@adc/protocol";
import { evaluatePolicy, type PolicyContext } from "./index.ts";

function invocation(tool = "file.read", args: Record<string, unknown> = {}): Invocation {
  return InvocationSchema.parse({
    schemaVersion: "0.1",
    invocationId: "inv_policytest",
    attemptId: "att_policytest",
    accountId: "acct_primary",
    actor: { type: "agent", id: "actor_testagent" },
    target: { nodeId: "node_macbook" },
    authorization: {
      projectId: "proj_example",
      rootIds: ["root_workspace"],
      grantId: "grant_example"
    },
    tool,
    args: { rootId: "root_workspace", path: "src/index.ts", ...args },
    issuedAt: "2026-09-24T00:00:00.000Z",
    expiresAt: "2026-09-24T00:05:00.000Z",
    ...(tool === "file.write" || tool.startsWith("mcp.")
      ? { idempotencyKey: "policy-write-test" }
      : {}),
    metadata: { source: "sdk" }
  });
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    account: {
      allowedTools: ["file.read", "file.write", "test.run"],
      deniedTools: [],
      approvalRequiredTools: [],
      unattendedAllowed: false
    },
    agent: {
      profile: "workspace-write",
      nodeIds: ["node_macbook"],
      rootIds: ["root_workspace"],
      allowedTools: ["file.read", "file.write", "test.run"]
    },
    node: {
      nodeId: "node_macbook",
      online: true,
      revoked: false,
      advertisedTools: ["file.read", "file.write", "test.run"],
      disabledTools: [],
      roots: [{ rootId: "root_workspace", path: "/workspace", writable: true }]
    },
    ...overrides
  };
}

describe("evaluatePolicy", () => {
  it("allows only when every layer intersects", () => {
    const result = evaluatePolicy(context(), invocation());
    expect(result.outcome).toBe("allow");
    expect(result.decisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed for an ungranted root", () => {
    const result = evaluatePolicy(
      context({
        agent: {
          ...context().agent,
          rootIds: []
        }
      }),
      invocation()
    );
    expect(result).toMatchObject({
      outcome: "deny",
      reasonCode: "agent.root_not_granted"
    });
  });

  it("authorizes an absolute path through the most specific advertised root", () => {
    const legacy = invocation();
    const absolute = InvocationSchema.parse({
      ...legacy,
      args: { path: "/workspace/src/index.ts" }
    });
    expect(evaluatePolicy(context(), absolute)).toMatchObject({
      outcome: "allow",
      reasonCode: "policy.allowed"
    });
    const outside = InvocationSchema.parse({
      ...legacy,
      args: { path: "/private/secret.txt" }
    });
    expect(evaluatePolicy(context(), outside)).toMatchObject({
      outcome: "deny",
      reasonCode: "node.root_unavailable"
    });
  });

  it("does not silently place work on an offline explicit device", () => {
    const result = evaluatePolicy(
      context({ node: { ...context().node, online: false } }),
      invocation()
    );
    expect(result).toMatchObject({ outcome: "deny", reasonCode: "node.offline" });
  });

  it("requires approval for side effects under approve-required", () => {
    const write = invocation("file.write", { content: "new" });
    const result = evaluatePolicy(
      context({ agent: { ...context().agent, profile: "approve-required" } }),
      write
    );
    expect(result.outcome).toBe("approval_required");
  });

  it("keeps read-only profiles unable to write", () => {
    const result = evaluatePolicy(
      context({ agent: { ...context().agent, profile: "read-only" } }),
      invocation("file.write", { content: "new" })
    );
    expect(result).toMatchObject({ outcome: "deny", reasonCode: "agent.capability_denied" });
  });

  it.each([
    ["never", "file.write", "allow"],
    ["writes", "file.write", "approval_required"],
    ["writes", "file.read", "allow"],
    ["execute", "file.write", "allow"],
    ["always", "file.read", "approval_required"]
  ] as const)("separates %s approval from capability %s", (approvalPolicy, tool, outcome) => {
    expect(
      evaluatePolicy(
        context({ agent: { ...context().agent, approvalPolicy } }),
        invocation(tool, tool === "file.write" ? { content: "new" } : {})
      ).outcome
    ).toBe(outcome);
  });

  it("does not turn no-approval into permission to write a read-only root", () => {
    expect(
      evaluatePolicy(
        context({
          agent: { ...context().agent, approvalPolicy: "never" },
          node: { ...context().node, roots: [{ rootId: "root_workspace", writable: false }] }
        }),
        invocation("file.write", { content: "new" })
      )
    ).toMatchObject({ outcome: "deny", reasonCode: "root.read_only" });
  });

  it("keeps account approval requirements above the Agent preference", () => {
    expect(
      evaluatePolicy(
        context({
          agent: { ...context().agent, approvalPolicy: "never" },
          account: { ...context().account, approvalRequiredTools: ["file.read"] }
        }),
        invocation()
      ).outcome
    ).toBe("approval_required");
  });

  it("treats custom MCP tools as execution-risk capabilities", () => {
    const tool = "mcp.github.search.1234abcd";
    const customContext = context({
      account: { ...context().account, allowedTools: [tool] },
      agent: {
        ...context().agent,
        allowedTools: [tool],
        approvalPolicy: "execute"
      },
      node: { ...context().node, advertisedTools: [tool] }
    });
    expect(evaluatePolicy(customContext, invocation(tool, { query: "is:open" }))).toMatchObject({
      outcome: "approval_required",
      reasonCode: "approval.required"
    });
    expect(
      evaluatePolicy(
        { ...customContext, agent: { ...customContext.agent, profile: "read-only" } },
        invocation(tool, { query: "is:open" })
      )
    ).toMatchObject({ outcome: "deny", reasonCode: "agent.capability_denied" });
  });
});
