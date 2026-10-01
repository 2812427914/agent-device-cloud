import { describe, expect, it } from "vitest";
import type { NodeRecord } from "@adc/db";
import { CapabilitySchema } from "@adc/protocol";
import { effectiveCapability } from "./resource-management.ts";

describe("effective mobile capability", () => {
  it("keeps unavailable tools visible in the raw manifest but not executable", () => {
    const node: NodeRecord = {
      nodeId: "node_android",
      accountId: "acct_example",
      label: "Phone",
      publicKey: "unused",
      platform: "android",
      status: "active",
      accessPolicy: {
        rootAccess: "all",
        rootIds: [],
        readOnlyRootIds: [],
        allowExecution: true,
        maxConcurrency: 1
      },
      capability: CapabilitySchema.parse({
        schemaVersion: "0.1",
        nodeId: "node_android",
        tools: [
          {
            name: "device.battery.get",
            version: "0.1.0",
            risk: "read",
            sandboxProfiles: ["native-app"],
            availability: {
              state: "available",
              observedAt: "2026-10-01T00:00:00.000Z"
            }
          },
          {
            name: "location.get",
            version: "0.1.0",
            risk: "read",
            sandboxProfiles: ["native-app"],
            availability: {
              state: "foreground_required",
              reason: "Open the app.",
              observedAt: "2026-10-01T00:00:00.000Z"
            }
          }
        ],
        roots: [],
        accessMode: "none",
        platform: "android",
        nodeVersion: "0.1.0",
        advertisedAt: "2026-10-01T00:00:00.000Z"
      }),
      createdAt: "2026-10-01T00:00:00.000Z"
    };

    expect(node.capability?.tools.map((tool) => tool.name)).toEqual([
      "device.battery.get",
      "location.get"
    ]);
    expect(effectiveCapability(node)?.tools.map((tool) => tool.name)).toEqual([
      "device.battery.get"
    ]);
  });
});
