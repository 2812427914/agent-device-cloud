# System architecture

This document is the visual map of the implementation. Solid paths describe current behavior.
Planned components are explicitly marked and must not be read as shipped capability.

## System context

```mermaid
flowchart LR
  subgraph Interfaces["Agent interfaces"]
    MCP["Remote MCP client"]
    CLI["adc account / tool CLI"]
    SKILL["Official Skill"]
    SDK["SDK / HTTP client"]
  end

  subgraph Cloud["Control Plane"]
    AUTH["Identity and credentials"]
    POLICY["Grant and policy evaluation"]
    ROUTER["Placement, approval and dispatch"]
    AUDIT["Results, receipts and audit"]
  end

  DB[("PostgreSQL")]

  subgraph Device["User device"]
    NODE["Device Connector"]
    RUNTIME["Local Tool Runtime"]
    FILES["Authorized files"]
    TOOLS["Local commands and tests"]
    MCPPROVIDERS["Local MCP Providers<br/>stdio / Streamable HTTP"]
    LEDGER[("Durable receipt ledger")]
  end

  MCP -->|"OAuth + MCP"| AUTH
  CLI -->|"Account login or scoped connection"| AUTH
  SKILL -->|"orchestrates CLI"| CLI
  SDK -->|"Scoped access key + HTTPS"| AUTH
  AUTH --> POLICY
  POLICY --> ROUTER
  ROUTER <--> DB
  AUDIT <--> DB
  ROUTER -->|"WebSocket wake signal"| NODE
  NODE -->|"signed poll / ACK / lease / receipt"| ROUTER
  NODE --> RUNTIME
  RUNTIME --> FILES
  RUNTIME --> TOOLS
  RUNTIME -->|"tools/call"| MCPPROVIDERS
  RUNTIME <--> LEDGER
  RUNTIME -->|"result / artifact"| AUDIT
```

### Source map

| Responsibility                            | Implementation                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Invocation, result and capability schemas | `packages/protocol/src/index.ts`                                            |
| Policy intersection                       | `packages/policy/src/index.ts`                                              |
| Authentication and OAuth                  | `apps/control-plane/src/auth.ts`, `apps/control-plane/src/access.ts`        |
| Placement and dispatch API                | `apps/control-plane/src/app.ts`                                             |
| Durable dispatch state                    | `packages/db/src/postgres-store.ts`                                         |
| WebSocket wake, fallback poll and leases  | `apps/control-plane/src/node-wake.ts`, `apps/node/src/daemon.ts`, `wake.ts` |
| Local MCP discovery and routing           | `apps/node/src/mcp-providers.ts`                                            |
| Local execution                           | `packages/tool-runtime/src/runtime.ts`                                      |
| Path safety                               | `packages/tool-runtime/src/path-security.ts`                                |
| Local idempotency ledger                  | `packages/tool-runtime/src/receipt-ledger.ts`                               |
| MCP translation                           | `packages/mcp-adapter/src/index.ts`                                         |
| CLI and shared client                     | `apps/cli/src/main.ts`, `packages/client/src/index.ts`                      |
| Human control surface                     | `apps/console/src/main.tsx`, `apps/console/src/agents.tsx`, `overview.tsx`  |
| Public product and docs                   | `apps/console/src/landing.tsx`, `apps/console/src/docs.tsx`                 |

## Pairing and first authorization

```mermaid
sequenceDiagram
  actor User
  participant Manage as Console / adc CLI
  participant CP as Control Plane
  participant DB as PostgreSQL
  participant Node as Device Connector

  User->>Manage: Add device
  Manage->>CP: POST /api/v1/pairing-codes
  CP->>DB: Store short-lived code hash
  User->>Node: Run generated installer command
  Node->>Node: Generate Ed25519 key pair
  Node->>CP: Consume code + public key
  CP->>DB: Atomically pair device
  CP-->>Node: nodeId + accountId
  Node->>Node: Persist private key with mode 0600
  Node->>CP: Signed outbound WebSocket upgrade
  CP-->>Node: Wake channel established
  Node->>CP: Signed poll + capability advertisement
  CP->>DB: Save presence and exposed path metadata
  User->>Manage: Create Agent access
  Manage->>CP: Devices + folders + tools + approval policy
  CP->>DB: Save scoped grant and audit event
```

The pairing code is not a device credential. It is consumed once and replaced by a device-generated
key pair. The private key never needs to reach the Control Plane.

The wake connection is also outbound and authenticated with a one-time signed request proof. A wake
contains no invocation payload or authorization decision; it only prompts the Connector to call the
normal signed poll endpoint. Reconnect performs an immediate poll, and a 30-second fallback poll
recovers work if the connection or an individual signal is lost.

## CLI account login

```mermaid
sequenceDiagram
  actor User
  participant CLI as adc CLI
  participant Browser
  participant CP as Control Plane
  participant DB as PostgreSQL

  CLI->>CP: Request short-lived device authorization
  CP->>DB: Store device code and user code
  CP-->>CLI: Verification URL + visible code
  CLI-->>User: Open or print verification URL
  User->>Browser: Sign in with GitHub or email
  Browser->>CP: Claim request with account session
  User->>Browser: Confirm matching code
  Browser->>CP: Approve request
  loop Until approved or expired
    CLI->>CP: Poll with device code
  end
  CP->>DB: Create independent CLI session
  CP-->>CLI: One-time session bearer
  CLI->>CLI: Store mode-0600 login state
```

The browser session is never copied into the terminal. The one-time code is bound to the first
signed-in user who opens it, expires after ten minutes and can be redeemed once. CLI management
requests use the resulting revocable account session; device tool calls still use the separately
scoped connection selected by `adc connect`.

## Invocation lifecycle

```mermaid
sequenceDiagram
  participant Agent
  participant CP as Control Plane
  participant DB as PostgreSQL
  participant Node as Device Connector
  participant RT as Local Tool Runtime

  Agent->>CP: Invocation + Agent credential
  CP->>DB: Resolve account, grant and device
  CP->>CP: Validate schema, placement and policy

  alt Approval required
    CP->>DB: Persist pending approval
    CP-->>Agent: approval_required
    Note over CP,DB: Approval waits without a device lease
  else Allowed
    CP->>DB: Enqueue dispatch + audit atomically
    CP-->>Agent: queued + jobId
  end

  Note over CP,Node: After initial or approved dispatch enqueue
  CP-->>Node: WebSocket dispatch.available
  Node->>CP: Signed poll
  CP->>DB: Claim with SKIP LOCKED and lease token
  CP-->>Node: Invocation + policy decision
  Node->>CP: Signed ACK
  Node->>RT: Revalidate local scope and execute

  loop Until terminal
    Node->>CP: Renew lease
    CP->>DB: Re-evaluate current authorization
  end

  RT->>RT: Persist terminal receipt locally
  Node->>CP: Upload artifact when needed
  Node->>CP: Upload result + receipt
  CP->>DB: Commit immutable terminal state + audit
  Agent->>CP: Poll job
  CP-->>Agent: Result + receipt
```

## Effective authorization

Authorization is a sequence of narrowing gates. Passing one gate never grants permission denied by
another.

```mermaid
flowchart LR
  REQUEST["Typed invocation"]
  ACCOUNT["Account isolation<br/>principal matches account"]
  GRANT["Agent grant<br/>device + tool + root"]
  DEVICE["Cloud device policy<br/>root visibility + read-only + execution"]
  CAP["Live capability<br/>currently advertised by Node"]
  LOCAL["Local device policy<br/>realpath + writable + mode"]
  APPROVAL{"Approval policy"}
  QUEUE["Dispatch"]
  DENY["Structured denial"]
  WAIT["Pending approval"]

  REQUEST --> ACCOUNT --> GRANT --> DEVICE --> CAP --> LOCAL --> APPROVAL
  ACCOUNT -. mismatch .-> DENY
  GRANT -. outside grant .-> DENY
  DEVICE -. narrowed .-> DENY
  CAP -. unavailable .-> DENY
  LOCAL -. local refusal .-> DENY
  APPROVAL -->|"not required"| QUEUE
  APPROVAL -->|"required"| WAIT
```

The current account layer enforces ownership and identity separation. It is not yet a configurable
organization-wide policy editor.

## MCP tool and target projection

Machine count does not multiply the Agent-facing tool catalog. Before answering `tools/list`, the
Control Plane groups identical logical tools and computes the valid target set from the Agent grant
and each device's latest effective capability.

```mermaid
flowchart LR
  A["Agent grant"] --> P["Tool projection"]
  L1["GitHub MCP<br/>tools/list"] --> N1["Mac A<br/>file.read + mcp.github.search.HASH"]
  L2["GitHub MCP<br/>tools/list"] --> N2["Linux B<br/>file.read + shell.exec + mcp.github.search.HASH"]
  N1 --> P
  N2 --> P
  P --> T1["file.read<br/>nodeId: Mac A | Linux B"]
  P --> T2["mcp.github.search.HASH<br/>nodeId: Mac A | Linux B"]
  P --> T3["shell.exec<br/>nodeId: Linux B"]
```

Each logical tool is returned once. Device-executed tools require the model to choose a
`target.nodeId` from the generated enum. A tool with no valid device instance is omitted. This
projection prevents known-invalid tool/Node combinations from entering the model request, but it is
not an authorization boundary: invocation handling and the selected device still re-evaluate the
grant, effective capability, resource scope and local policy before execution.

A device Connector is an MCP client to each configured local Provider. It discovers tools with
`tools/list`, converts each contract to a stable
`mcp.<provider-id>.<source-name>.<schema-hash>` Tool ID and advertises the JSON Schema through the
normal device capability envelope. The Control Plane never opens the Provider connection and never
receives Provider commands, environment variables or HTTP headers. At execution time it dispatches
an authorized invocation to the selected Node; the Connector maps the stable ID back to the
original Provider tool and performs `tools/call`.

The Provider ID must be consistent across devices for equivalent tools to aggregate. A changed input
or output schema produces a new Tool ID, so an existing grant cannot silently authorize a changed
contract. Custom MCP tools are treated as execution-risk side effects: registration is not
authorization, an idempotency key is mandatory, and read-only/unattended profiles reject them.

## Dispatch state machine

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> leased: Node claim
  leased --> running: ACK
  leased --> leased: lease expired and reclaimed
  running --> running: lease renewal
  running --> cancel_requested: revoke / delete / cancel / local scope change
  cancel_requested --> cancelled: Node stops process
  queued --> cancelled: cancel before execution
  leased --> cancelled: cancel before ACK
  running --> succeeded: terminal receipt
  running --> failed: terminal receipt
  running --> denied: local refusal
  running --> unknown_outcome: effect cannot be proven
  succeeded --> [*]
  failed --> [*]
  denied --> [*]
  cancelled --> [*]
  unknown_outcome --> [*]
```

Terminal database states do not regress. An expired lease permits reconciliation, but a side effect
is not automatically re-executed when the local ledger contains an unresolved `started` entry.

## Side-effect durability

```mermaid
flowchart TD
  A["Receive side-effecting invocation"] --> B{"Idempotency entry exists?"}
  B -->|"No"| C["fsync started entry"]
  C --> D["Execute operation"]
  D --> E{"Terminal entry persisted?"}
  E -->|"Yes"| F["Return result + immutable receipt"]
  E -->|"No"| G["Return unknown_outcome"]
  B -->|"Completed, same input"| H["Replay prior receipt"]
  B -->|"Started, no terminal result"| G
  B -->|"Same key, different input"| I["Conflict"]
```

The system provides at-least-once delivery with durable deduplication. It intentionally does not
claim exactly-once execution.

## Data ownership

| Data                                       | Control Plane | Device |
| ------------------------------------------ | ------------- | ------ |
| Account, sessions and Agent grants         | Yes           | No     |
| Device public key and disclosed path names | Yes           | Yes    |
| Device private key                         | No            | Yes    |
| Unrequested file content                   | No            | Yes    |
| Invocation arguments and returned result   | Yes           | Yes    |
| Large returned artifact                    | Yes, current  | Yes    |
| Local execution ledger                     | No            | Yes    |
| Dispatch and account audit                 | Yes           | No     |

Artifacts currently use PostgreSQL blobs. External object storage, quotas and retention jobs are
planned, not implemented.

## Current and planned boundaries

```mermaid
flowchart LR
  subgraph Current
    PERSONAL["Personal accounts"]
    MACLINUX["macOS / Linux / Windows Node"]
    ANDROID["Android native capability Node MVP"]
    PROCESS["Restricted process / full trust"]
    POSTGRES["PostgreSQL dispatch + artifacts"]
    INTERFACES["MCP / CLI / Skill / SDK"]
  end

  subgraph Next["Next: production hardening"]
    SIGNED["Signed releases"]
    KEYCHAIN["Keychain / keyring"]
    OBJECTS["External artifact storage + quotas"]
    DOCTOR["Doctor + backup automation"]
  end

  subgraph Later
    CONTAINER["Linux container isolation"]
    TEAM["Teams / RBAC / SSO / SIEM"]
    MOBILE["Additional mobile capabilities / iOS"]
    PLUGINS["Tool plugin ecosystem"]
  end

  Current --> Next --> Later
```

See [product direction](product-direction.md), [threat model](threat-model.md), and
[implementation status](implementation-status.md) for the corresponding product contract,
security details and verified implementation state.

The [device integration assessment](device-integration-assessment.md) inventories mobile,
wearable, router and home-device constraints, gateway options and current implementation gaps.
The Android MVP is the first native mobile implementation; the broader device bindings and adapters
in that assessment remain proposed capabilities.
