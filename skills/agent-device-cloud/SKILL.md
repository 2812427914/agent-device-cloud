---
name: agent-device-cloud
description: Use an authorized Agent Device Cloud node through the public adc CLI for file work, tests, tasks, and receipts.
version: 0.1.0
requirements:
  cli: "adc >=0.1.0 <0.2.0"
  protocol: "0.1"
---

# Agent Device Cloud

Use this skill when work must execute on a user's already paired device. This skill only
orchestrates the public `adc` CLI. Never read Node credentials or call Node poll/receipt endpoints.

## Preconditions

1. Run `adc node list --json`. Tool calls require a scoped Agent token, imported by the user with
   `adc auth token --url <installation-origin>` or supplied through `ADC_URL` and `ADC_TOKEN`.
   Hosted and self-hosted installations use the same login and authorization flow. A management
   login alone does not authorize Agent tools; ask the user to create a grant/token in Agent access
   if no token is configured. Never request the user's password or copy their management session.
2. Use the device selected by the user. A grant with one device selects it automatically; with
   multiple devices, pass `--node <node-id>`. Projects are optional: only use `--project` when the
   user's grant is project-scoped. Account, actor, devices and grant context come from the token's
   current `/me` response; do not invent or broaden them.
3. Address resources with `target.nodeId` and an absolute POSIX path advertised for that device.
   All-folder grants include newly exposed folders; selected-folder grants remain fixed. Rediscover
   after local scope changes. `rootId` plus a relative path is accepted only for compatibility with
   older callers. Pairing itself does not require a folder, but file/command operations require an
   exposed path.
4. Treat `--json` as the only machine-readable CLI output.

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
- Do not read `node.json`, device state, or the CLI's `.session` file.
- Do not use management sessions to approve an Agent's own work or create broader grants.
- Use canonical absolute POSIX paths. Do not use `..`, backslashes, duplicate separators or a
  trailing slash.
- Physical paths are intentionally visible in capability, approval and audit data. Do not expose a
  path whose name itself contains sensitive information.
- Do not use `shell.exec` when a file or command-template tool can express the operation.
- Do not start persistent services or terminal sessions.
- Do not claim that `restricted-process` provides hard network or filesystem isolation.
- Full device trust uses the connector user's OS authority without ADC's command/protected-file
  filters. It does not remove grant capabilities, writable flags, approvals, leases or revocation.
- Scope changes happen locally with `adc-node roots` / `adc-node access` and hot reload; never
  edit device identity/configuration or expand access on behalf of an Agent.
