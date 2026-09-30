# @adc/client

Typed client for the [Agent Device Cloud](https://github.com/zionforge/agent-device-cloud)
Control Plane API. One contract across HTTP, CLI, MCP and SDK.

## Install

```sh
npm install @adc/client
```

## Usage

### Browser and shared (no Node built-ins)

```ts
import { AdcClient } from "@adc/client";

const client = new AdcClient(
  "https://devices.example.com",
  process.env.ADC_ACCESS_KEY!,            // Agent access key or owner PAT
  fetch                                    // optional, defaults to global fetch
);

// Agent scope: one call returns grant + authorized nodes (with root paths
// and descriptions) + tool-to-node mapping.
const me = await client.me();

// Owner scope (owner PAT or session credential)
const nodes = await client.listNodes();
await client.updateNode(nodes[0]!.nodeId, {
  revision: nodes[0]!.revision ?? 1,
  label: "MacBook Pro",
  description: "主力本机 · M2 Pro / 32G",
  accessPolicy: nodes[0]!.accessPolicy ?? { rootAccess: "all", rootIds: [], readOnlyRootIds: [] }
});
const approvals = await client.listApprovalsPage({ status: "pending" });
```

The main entry runs in browsers, Workers and Node without any Node built-in,
so harness plugins and consoles can bundle it directly.

### Node-only device protocol

```ts
import { NodeApiClient, generateNodeKeyPair } from "@adc/client/node";
```

`@adc/client/node` carries the Ed25519-signed Connector protocol and requires
Node built-ins. Use it from the `adc-node` daemon; never from a browser.

## Authentication boundaries

- **Agent access key** — `adc connect` credential, scoped to one grant: inspect
  `/me`, submit invocations, poll tasks.
- **Owner PAT** — `adc pat create`, account-level management identity, optional
  `readOnly`. Cross-origin friendly (no cookies involved).
- **Session** — console cookie / CLI management session.

Tokens are shown once at creation; the server stores only a SHA-256 hash.
