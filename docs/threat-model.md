# Threat Model v0.1

## Assets

- Device files, developer tools, local credentials and network access
- Device private keys, user sessions, passwords and Agent/OAuth tokens
- Grants, root bindings, policy decisions and pairing codes
- Dispatch state, receipts, artifacts and audit history

## Trust Boundaries

1. Agent or CLI to Control Plane over authenticated HTTPS
2. Control Plane to PostgreSQL
3. Device Node to Control Plane over outbound authenticated HTTPS
4. Device Node to local Tool Runtime
5. Restricted child process to the host filesystem and network

The Control Plane is trusted to coordinate and authorize. Public resource addresses contain a
device ID and absolute path; exposed root paths are account metadata stored in device capability
advertisements. Root IDs remain internal compatibility bindings and device private keys remain
local. Tool content can itself contain paths or secrets, so redaction is a best-effort defense, not
a guarantee that arbitrary output is safe. Capability advertisement is untrusted input and is never
authorization.

Hosted and self-hosted use the same authentication and authorization implementation. Anonymous
requests can reach the public website, installer downloads, login/registration, protocol discovery,
pairing-code consumption and health;
account management and tool APIs require a validated principal.

Local none/selected/home/full access is the upper bound. Direct Agent grants select devices and
either fixed root IDs or all advertised roots, explicitly including future roots on those devices.
Capabilities and approvals are independent. Directory removal and downgrade cancel affected work.
Projects provide optional grouping; they are not a prerequisite for authorization.

Command/network classifiers, protected-file checks and rebuilt child environments below apply to
selected/home access. **Full device trust intentionally disables those controls and inherits the
connector environment**, using the current OS user's authority. It still enforces grant capabilities,
advertised-path boundaries, local writability, approvals, expiry, revocation and receipts.

## Threats and Controls

| Threat                               | Control                                                                                                                                       | Residual risk                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Stolen pairing code                  | Random short-lived one-time code; atomic consumption                                                                                          | Attacker using it before the intended device can pair; user must revoke                                                  |
| Replayed Node request                | Ed25519 signature over request, five-minute timestamp and durable nonce                                                                       | Compromised device private key remains valid until revoke                                                                |
| Account/session compromise           | Better Auth password hashing, persistent rate limits, HttpOnly SameSite cookies, same-origin mutation checks, revocable sessions and reset    | Compromised user sessions can administer that user's account; protect mail and local CLI session storage                 |
| Agent targets another account/device | Account and grant checks precede placement; Agent tokens are hashed/expiring/revocable; management requires a user session                    | Execution authority remains the selected device OS user's authority                                                      |
| OAuth code/token theft               | PKCE, resource audience, explicit grant consent, rotating refresh, per-binding generation and revocation                                      | DCR client names are unverified; CIMD/client certification is not implemented                                            |
| Path traversal or symlink escape     | Canonical absolute-path validation, longest-root authorization, `realpath`, final-component `O_NOFOLLOW`, descriptor identity checks          | Portable Node APIs cannot eliminate all hostile parent-directory races or hard-link aliases                              |
| Sensitive file or path disclosure    | Protected path segments, account-scoped metadata and output secret redaction                                                                  | Authorized users see exposed physical paths; heuristic redaction cannot identify every secret                            |
| Duplicate side effect                | Required idempotency key, atomic/fsynced local started/completed ledger, validated replay, immutable terminal state                           | Crash after effect but before receipt produces `unknown_outcome`; lost device state cannot prove earlier execution       |
| Concurrent file creation/edit        | Create-only publishes with atomic no-replace link; fsynced temp + rename for replacement; same-runtime edit serialization and content recheck | Concurrent external writers and parent-directory races remain outside portable atomic compare-and-swap guarantees        |
| Template root confusion              | Actual template project/root must match the invocation; all process tools require execution permission and writable roots                     | A command template can execute arbitrary code; a `readOnly` label is not a sandbox                                       |
| Command injection                    | Shell command is an explicit capability; templates avoid interpolation; dangerous command classifier                                          | `restricted-process` is not hard isolation and an authorized shell can still affect host state                           |
| Credential inheritance               | Rebuilt environment, reserved-variable rejection, non-login shell without startup profiles, per-call temp directory                           | Executed code can discover files accessible to the device OS user, including Node state outside the root                 |
| Local MCP Provider compromise        | Provider endpoints/configuration stay on-device; custom tools require an explicit grant, target Node and idempotency key; HTTP requires TLS   | A granted Provider executes with its own process/service authority and can return sensitive data through the tool result |
| Network exfiltration                 | Obvious network commands rejected by a heuristic classifier; authorization and audit                                                          | Arbitrary shell code can use networking; there is no hard network deny or injected proxy                                 |
| Queue race or stale worker           | `SKIP LOCKED`, lease token, deadline watchdog, process-group cancellation and conditional terminal update                                     | Uninterruptible or escaped processes require OS-level isolation; terminal receipts remain the reconciliation authority   |
| Receipt tampering                    | Receipt hashes input, output, policy and idempotency key; upload bound to signed Node request                                                 | Receipt signing as a standalone portable object is deferred                                                              |
| Audit deletion                       | PostgreSQL ownership and append-oriented API                                                                                                  | Database administrators can alter self-hosted audit data                                                                 |

GitHub login uses verified provider email, state/cookie validation and same-origin redirects.
Registration closure applies to social users too. Unverified local accounts cannot be implicitly
linked by email; authenticated owners can explicitly link a matching verified GitHub identity.
GitHub tokens are encrypted with the installation auth secret; compromising that secret and the
database compromises the stored tokens.

## Default Denials

- Unknown protocol versions or fields
- Relative public file paths, backslashes, duplicate separators, `.`/`..` segments, paths outside
  an advertised and granted root, and sensitive paths in selected/home mode. The legacy
  `rootId`-relative form remains accepted for protocol-0.1 callers.
- Unbound or revoked devices, roots and grants
- Multiple matching devices without explicit affinity
- Side effects without idempotency keys
- Custom MCP tools absent from the selected device, missing an explicit target Node, or using cleartext non-loopback HTTP
- Stale leases and mismatched receipts
- User sessions used as Agent credentials, and Agent credentials used for management
- Template execution through read-only grants/roots or through a different authorized root
- `sudo`, system service control, environment dumps, root deletion and network clients in the default
  restricted-process profile

## Required Security Tests

- Path traversal, symlink-to-file and symlink-to-parent escapes
- Pairing reuse, stale proof, bad signature, nonce replay and revoke
- Concurrent PostgreSQL claims and terminal-state monotonicity
- Lost ACK, lost receipt response, expired lease and Node restart
- Idempotency-key input conflict and orphaned `started` ledger
- Secret redaction, output truncation and opaque artifact references
- CLI/MCP/SDK adapter parity
- Two-user account isolation, CSRF, password recovery, verification, session revocation
- OAuth PKCE/audience, refresh rotation, grant/binding revocation and stale-code reconnect
- Concurrent create-only writes, expired receipt reconciliation, lease-loss and shutdown cancellation
- No-folder pairing, live scope reload, full trust, independent approvals and all/fixed-root grants
- GitHub private verified email, registration closure, state replay, safe callbacks and explicit linking

## Deferred Controls

- CIMD and named third-party OAuth client interoperability
- OS keychain and TPM-backed Node keys
- Signed portable receipts and external transparency log
- Linux container profile with hard filesystem/network policy
- Enterprise RBAC, SSO/SCIM and SIEM export
- Per-account storage/compute quotas, retention and deployment-level abuse controls
- External penetration test before public beta
