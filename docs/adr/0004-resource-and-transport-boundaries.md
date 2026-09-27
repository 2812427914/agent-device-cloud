# ADR-0004: Device Paths and Outbound Node Transport

- Status: accepted
- Date: 2026-09-24

## Decision

Public Tool IR identifies a resource with `target.nodeId` and a canonical absolute POSIX `path` or
`cwd`. A Node advertises the absolute paths it exposes. The client and control plane map a requested
path to the most specific advertised root for authorization; the Node repeats that mapping and
resolves the target with `realpath` on every call, including the nearest existing parent for creates.
Opaque `rootId` plus relative path remains accepted as a protocol-0.1 compatibility form and stays
the internal representation for saved policies and local command templates.

The Node makes outbound HTTPS poll, ACK and receipt requests. The business protocol does not depend
on long poll and may later use another transport without changing Tool IR or Receipt semantics.

## Consequences

- Authorization, approval and audit views are understandable without resolving opaque root IDs.
- Exposed physical paths become account metadata in the control plane and must be protected with
  the same access controls and retention policy as audit data.
- Symlink replacement is re-evaluated per operation.
- Device selection and resource authorization remain separate decisions.
- The M2 restricted-process shell is explicitly soft isolation; Linux container isolation is a
  separate future profile.
