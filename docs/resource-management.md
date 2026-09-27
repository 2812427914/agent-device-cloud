# Device and Agent authorization management

The console provides device management and in-place grant editing. Devices and grants retain
stable IDs, while an integer revision protects against concurrent lost updates.

## Device controls

Devices → Manage allows renaming, selecting all or specific advertised folders, marking individual
folders read-only and disabling command/test execution. The same panel shows affected Agents and
generates a local folder-add command. The Node advertises each exposed absolute path to the server so
the console, approvals and audit can show the actual resource being authorized.

The server computes effective capability from the raw Node advertisement and the saved device
policy. Local read-only folders cannot become writable through the console. Presence updates do not
overwrite the saved policy. New directory paths and home/full trust remain local owner choices.

## Agent controls

Agent access → Edit pre-fills the existing name, devices, folder scope, tool capabilities,
approval policy and optional project. Saving preserves the grant ID, actor ID, creation date,
credentials and OAuth binding generation. Existing tokens use the new permissions on the next call.
Cached MCP tool lists may require reconnecting the client, but cannot bypass current server checks.

Previously selected unavailable devices/folders remain visible so a rename cannot silently broaden
or discard access. The editor allows explicitly removing them. Legacy project grants and their
effective approval settings remain supported.

## Revoke and delete

Revocation stops access and leaves a record under the Revoked filter. Deletion marks the resource
revoked and deleted, removes it from management lists and retains its row for historical references.
It does not delete device files, receipt history or audit events.

Grant deletion invalidates every associated Agent credential and MCP OAuth binding. Their inactive
entries disappear from credential/connection lists. Device deletion stops the device and frees its
display name for a subsequent pairing with a new device identity. On the deleted device, run
`adc-node unpair --confirm <old-node-id>` before using a fresh pairing code. Exact ID confirmation
prevents accidental key loss; local durable receipts remain in the state directory.

Deletion, cancellation of queued/leased work, denial of pending approvals and its audit event are
committed in one transaction. Running work receives cancellation or loses its lease; no claim of
instant offline process termination is made. Normal permission edits are rechecked before dispatch,
ACK and lease renewal. Cancelled tasks are reported as cancelled through the task API.

## API and migration

All routes require an account-owner session and same-origin mutations; Agent tokens cannot manage
their own permissions. Foreign or deleted resources return 404. Stale revisions, revoked edits and
duplicate device names return 409.

| Route                            | Payload                                    |
| -------------------------------- | ------------------------------------------ |
| `PATCH /api/v1/nodes/:nodeId`    | `revision`, `label`, `accessPolicy`        |
| `DELETE /api/v1/nodes/:nodeId`   | `revision`                                 |
| `PATCH /api/v1/grants/:grantId`  | `revision` and all editable grant settings |
| `DELETE /api/v1/grants/:grantId` | `revision`                                 |

Device `accessPolicy` contains `rootAccess: all|selected`, internal `rootIds`, `readOnlyRootIds` and
`allowExecution`. Empty selected roots disable file access. Grant settings contain `name`,
`profile`, `nodeIds`, `rootAccess`, internal `rootIds`, `allowedTools`, optional `projectId` and
`approvalPolicy`. Read APIs augment these bindings with their advertised absolute paths. Public tool
calls use `target.nodeId` plus an absolute `path` or `cwd`; legacy callers may continue sending
`rootId` plus a relative path. The create route no longer overwrites an existing grant ID.

Migration `0005_resource_management.sql` adds policies, revisions and deletion timestamps, replacing
device-name uniqueness with a partial index over non-deleted devices. Existing policies default to
the previous unrestricted cloud view of the local advertisement. No existing access is expanded.
Migration `0006_reuse_revoked_node_labels.sql` limits name uniqueness to active devices. A retry also
replaces a same-account, same-name pairing that never completed its first device poll. This recovers
the narrow case where pairing succeeded remotely but the installer could not persist its private key.

## Validation

`tests/resource-management.e2e.test.ts` exercises real PostgreSQL/authentication/HTTP and the
official MCP client, plus MemoryStore parity: account/Agent boundaries, CSRF, name uniqueness,
revision conflicts, current MCP visibility, lease cancellation, same-token editing, retained OAuth
bindings, invalidation on deletion, pending approvals, name reuse, and retained completed receipts.
The console rendering check exercises both languages, legacy approval pre-fill, unavailable scope,
locally read-only folders and deletion dialogs without browser automation.
