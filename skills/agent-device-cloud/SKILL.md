---
name: agent-device-cloud
description: Manage and use Agent Device Cloud through the public adc and adc-node CLIs.
version: 0.1.0
requirements:
  cli: "adc >=0.1.0 <0.2.0"
  protocol: "0.1"
---

# Agent Device Cloud

Use this skill to connect and manage devices or execute work on an authorized device. Only
orchestrate the public `adc` and documented `adc-node` commands. Never read stored credentials,
Node identity files, or call Node poll/receipt endpoints.

## Preconditions

1. Run `adc status --json`. Account management requires the user to complete
   `adc login --url <installation-origin> --email <email>`. Never request, receive or enter the
   user's password. Tool calls require a connection selected with `adc connect <access>`; this
   creates and stores the scoped credential without printing it.
2. Use the device selected by the user. Access with one device selects it automatically; with
   multiple devices, pass `--node <node-id>`. Projects are optional: only use `--project` when the
   user's access is project-scoped. Account, actor, devices and authorization context come from the
   current connection's `/me` response; do not invent or broaden them.
3. Address resources with `target.nodeId` and an absolute POSIX path advertised for that device.
   All-folder grants include newly exposed folders; selected-folder grants remain fixed. Rediscover
   after local scope changes. `rootId` plus a relative path is accepted only for compatibility with
   older callers. Pairing itself does not require a folder, but file/command operations require an
   exposed path.
4. Treat `--json` as the only machine-readable CLI output.

## Account Management

When the user asks to connect or manage infrastructure:

1. Inspect current state with `adc device list --json`, `adc access list --json` and
   `adc connection list --json`.
2. Create a one-time installation command with
   `adc device add --name <name> --json`. Run it on the target only through a channel the user
   already authorized, or return the command for the user to run there.
3. Create or update access with `adc access create|update`. Prefer names in user-facing commands
   and stable IDs in follow-up automation.
4. Connect this CLI with `adc connect <access-id> --json`; never extract or print the stored secret.
5. Use `--yes` only when the user explicitly requested a revoke or removal.
6. Do not approve an operation initiated by this Agent. Leave approval as an independent user
   decision.
7. Check client updates with `adc update --check --json`. Run `adc update` only when the user asks
   to update or has explicitly delegated routine maintenance, and do not update while device work
   is running because the Connector restarts after activation.

Cloud device policy may only narrow folders already exposed by a Connector. On the current device,
documented `adc-node roots`, `adc-node access`, `adc-node templates` and `adc-node mcp` commands may
be used when the user explicitly asks to change local Connector settings. Do not route these local
configuration commands through a remote `shell.exec`.

## Golden Path

1. List or search before reading:
   `adc invoke file.list --node <node-id> --args '{"path":"/absolute/folder"}' --source skill --json`
   Omit `--node` for a sole authorized device. No project creation is required.
2. Read the exact file with `file.read`.
3. Use `file.edit` for a unique replacement or `file.patch` for a reviewed unified diff.
4. For every side effect, create a stable workflow-scoped `--idempotency-key`. Reuse it only when
   retrying the exact same tool and arguments.
5. Run `test.run` with an absolute `cwd` below an authorized path and the template ID. Testing is
   execution, requires a writable path and an execution-capable grant, and cannot use a read-only
   grant. Do not assume `test` exists; discover templates with `command.template.list` when
   authorized.
6. If the result is queued, poll `adc task status <jobId> --json` until terminal.
7. Fetch truncated output through `adc artifact get <artifactId> --output <path> --json`.
8. Inspect `adc audit show <invocationId> --json` and report the policy decision and receipt ID.

Set `--source skill` on invocations so audit records distinguish this workflow from direct CLI use.

## Error Handling

- Exit 20 / `denied`: do not retry or broaden scope. Explain the policy reason.
- Exit 21 / `approval_required`: stop and ask the user to approve in the control plane.
- Exit 22 / `offline`: keep the explicit target; ask the user to wake or reconnect that device.
- Exit 23 / `unknown_outcome`: do not create a new idempotency key. Inspect audit/receipt and
  reconcile before any retry.
- `ambiguous_target`: show candidates and ask the user to select one. Never choose silently.
- Exit 24 / `cancelled`: report cancellation; do not present it as a tool failure.

## Constraints

- Do not parse human-readable CLI output.
- Do not read `node.json`, device state, CLI configuration or login files.
- Do not approve an Agent's own work.
- Use canonical absolute POSIX paths. Do not use `..`, backslashes, duplicate separators or a
  trailing slash.
- Physical paths are intentionally visible in capability, approval and audit data. Do not expose a
  path whose name itself contains sensitive information.
- Do not use `shell.exec` when a file or command-template tool can express the operation.
- Do not start persistent services or terminal sessions.
- Do not claim that `restricted-process` provides hard network or filesystem isolation.
- Full device trust uses the connector user's OS authority without ADC's command/protected-file
  filters. It does not remove grant capabilities, writable flags, approvals, leases or revocation.
- Scope changes happen through documented `adc-node` commands and hot reload. Never edit device
  identity/configuration files directly.
