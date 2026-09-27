# Product direction

## Positioning

Agent Device Cloud is private device infrastructure for AI agents.

It lets a user authorize an Agent to use selected files, tools and environments on the user's own
macOS and Linux devices. A lightweight control plane handles identity, policy, placement, approvals
and evidence. The selected device remains the execution environment and the final authorization
boundary.

The product is not a hosted shell, public compute marketplace, chat application, generic RPA system
or network tunnel.

## The problem

Useful work context already exists on machines users control:

- source repositories, dependencies and configured development tools;
- home servers, NAS devices, GPU workstations and private services;
- local credentials, VPN access and environments that are expensive or unsafe to reproduce;
- files and workflows that should not be copied wholesale into every Agent provider.

Agents increasingly run somewhere else: an MCP host, browser, IDE, mobile client, scheduled job or
third-party platform. Connecting these environments normally means broad credentials, inbound
network access, copied data or an unaudited remote shell.

Agent Device Cloud supplies the missing governed execution layer.

## Initial audience

### Individual developers

Continue work on an existing repository from another Agent interface, apply a focused change and run
the project's real test command on the machine where the environment already works.

### Self-hosters and technical operators

Expose narrowly selected folders or command templates from a home server, NAS or private workstation
without opening an inbound service on that device.

### Agent and tool builders

Integrate device capability through MCP, CLI, Skill, SDK or HTTP while relying on one versioned Tool
IR and one set of authorization and failure semantics.

Team and enterprise administration are later expansions. The current product must first make the
single-account trust model complete and understandable.

## Product contract

1. **Execution is local.** The Control Plane never runs the user's device tools.
2. **Connections are outbound.** A Node does not require an inbound public port.
3. **Authorization is an intersection.** Account, Agent, device, folder and capability policy must
   all permit an operation.
4. **The device has final authority.** Cloud policy can narrow locally exposed access, never expand
   it.
5. **Side effects leave evidence.** Mutating operations require idempotency and produce a durable
   receipt.
6. **Failure is explicit.** Denied, approval-required, offline, cancelled and unknown outcomes remain
   distinct states.
7. **Interfaces do not create new authority.** MCP, CLI, Skill, SDK and HTTP use the same
   authorization, dispatch and receipt path.
8. **Hosted and self-hosted are the same product.** Deployment choice does not remove identity,
   authorization or audit controls.

## Data contract

The Control Plane stores account and device metadata, disclosed absolute path names, grants,
invocation arguments, returned results, uploaded artifacts, policy decisions and receipts. Operators
must protect and retain this data accordingly.

The device private key, unrequested files and local environment remain on the device. The Control
Plane does not proactively crawl or mirror a filesystem. An authorized tool result can still contain
sensitive content; output redaction is a best-effort safeguard, not a confidentiality guarantee.

## Core scenarios

| Scenario                   | User outcome                                                        | Typical capability                         |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Continue local development | Inspect, edit and test an existing checkout                         | `file.read`, `file.patch`, `test.run`      |
| Use private infrastructure | Execute approved work where private resources are already available | `file.search`, `command.template.run`      |
| Move across interfaces     | Start from MCP, CLI, Skill or SDK without changing policy semantics | shared authorization and invocation model  |
| Controlled automation      | Run repeatable work with explicit boundaries and evidence           | templates, approval, idempotency, receipts |

## Architecture

```text
Agent / MCP host / CLI / Skill / SDK
                 |
                 | HTTPS + scoped Agent identity
                 v
Control Plane
  identity -> authorization -> placement -> approval -> dispatch -> audit
                 |
                 | outbound Node polling + signed ACK/lease/receipt
                 v
Device Connector
                 |
                 v
Local Tool Runtime
  path validation -> local policy -> execution -> durable receipt
```

PostgreSQL deliberately provides identity state, durable dispatch, approvals and audit in one
transaction boundary. A separate broker is introduced only after measured contention or
multi-region requirements justify the additional consistency model.

## Differentiated choices

- **Device network, not remote shell:** structured tools are the default; shell is an explicit
  capability and remains auditable.
- **Device-first authorization:** users expose resources locally before cloud grants can reference
  them.
- **Readable resources:** public operations use device ID plus absolute path so authorization and
  audit are understandable; internal root IDs remain compatibility bindings.
- **Honest delivery semantics:** dispatch is at-least-once. A crash window that cannot be reconciled
  becomes `unknown_outcome`, never an invented success or automatic duplicate.
- **No Agent lock-in:** each adapter submits the same governed invocation and receives the same
  Result and Receipt model.
- **Model-selected, system-constrained targets:** MCP exposes each logical tool once and restricts
  its target choices to granted devices that advertise that capability. The model selects the Node;
  the Control Plane validates the combination again before dispatch.
- **Local MCP composition:** a Connector can discover arbitrary stdio or Streamable HTTP MCP tools,
  advertise a schema-versioned logical ID and forward calls on the selected device. Provider secrets
  remain local, while registration and Agent authorization stay separate.
- **No deployment-tier security split:** self-hosted installations retain the complete account and
  authorization model.

## Roadmap

### Available now

- Personal account isolation, email/password and GitHub authentication.
- macOS and glibc Linux connectors for arm64 and x64.
- Local none, selected-folder, home and full-device access modes.
- Device policy, scoped Agent grants, approvals, audit and durable receipts.
- MCP OAuth, expiring Agent tokens, CLI, SDK and official Skill.
- Docker Compose self-hosting with PostgreSQL and Caddy.

### Next: production hardening

- Signed release packages and unattended Connector updates.
- Keychain and keyring-backed device identity.
- External artifact storage, account quotas and retention jobs.
- Automated diagnostics, backup verification and restore workflows.
- Named MCP client interoperability testing and compatibility documentation.
- Operational SLOs, alerting and a hosted service status page.

### Later: teams and ecosystem

- Linux container isolation for higher-risk execution.
- Team roles, shared device pools and multi-party approval workflows.
- Enterprise SSO, SCIM and SIEM export.
- Windows Connector.
- Additional local executors, a Tool plugin SDK and a community Skill ecosystem.

Roadmap entries are direction, not shipped capability. Current behavior and known limits remain
authoritative in [implementation-status.md](implementation-status.md).

## Trust before public release

Public trust requires evidence in addition to product copy:

- source history in a dedicated repository with reviewable releases;
- published checksums, signatures and an SBOM for every client artifact;
- a maintained threat model and private vulnerability reporting channel;
- reproducible integration tests across every supported operating system and architecture;
- documented data retention, deletion, backup and incident-response behavior;
- external security review before a hosted public beta;
- an honest compatibility matrix for named MCP clients;
- public changelog, migration notes and support policy.

## Success criteria

The product is working when a new user can connect one device and complete a governed Agent tool call
in under ten minutes, understand exactly why it was allowed, find its receipt, revoke access without
re-pairing and diagnose an offline device without reading server source code.
