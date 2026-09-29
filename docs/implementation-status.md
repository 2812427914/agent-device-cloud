# Implementation Status

## Implemented

- One shared application for hosted and self-hosted installations
- Better Auth email/password registration, login, email verification and password recovery
- GitHub login and explicit account linking, verified provider emails and registration-closure enforcement
- Browser-confirmed CLI login for GitHub or email accounts using short-lived device authorization
- PostgreSQL-backed revocable user sessions, account settings and per-user resource isolation
- Scoped Agent tokens with one-time display, hashes, expiration and revocation
- OAuth authorization-code/PKCE, MCP resource discovery/audience, refresh rotation and grant consent
- OAuth binding generations prevent old codes/tokens regaining access after reconnect
- Versioned invocation, capability, result and receipt schemas with committed protocol vectors
- Policy intersection and explainable decisions
- Direct device grants with fixed/all exposed folders; optional projects and independent approval policy
- Device management: rename, global folder/read-only/execution limits, affected-Agent visibility,
  revoke/delete, search and status filters
- In-place Agent authorization editing with stable IDs, existing Token/OAuth continuity, revoke/delete,
  search and status filters
- Optimistic revision checks, transactional deletion/cancellation and retained receipt/audit history
- Pairing without a directory, none/selected/home/full local access, multiple roots and automatic reload
- Scope removal/downgrade cancels affected running work while preserving device identity and receipts
- Full device trust uses the current OS user's permissions without command/protected-file filters
- Node-plus-absolute-path file/process tools with legacy root-relative compatibility, atomic
  create-only writes, bounded descriptor reads and template-root checks
- Stateless shell; restricted-mode environment checks, inherited environment in full trust, execution-only template/test access
- Fsynced and validated idempotency ledger, receipts, output redaction and artifacts
- One-time pairing, Ed25519 request proof, nonce replay prevention, key rotation and revoke
- PostgreSQL and in-memory stores
- Placement, dispatch, lease/ACK/renewal, deadline watchdog, cancellation and reconnect reconciliation
- Signed outbound WebSocket wake channel, heartbeat-backed presence, immediate reconnect catch-up
  and a 30-second durable fallback poll; wake messages never contain invocation data
- Persistent owner approval queue with approve, deny and expiry states
- REST client, CLI, stdio/HTTP MCP adapters and official Skill
- Account-management CLI for device enrollment/policy, Agent access, connections, projects,
  approvals and audit; `adc connect` provisions the current CLI without exposing its secret
- Local command-template add/list/remove commands with automatic Connector reload
- Device-side MCP Provider registry for stdio and Streamable HTTP, automatic `tools/list`
  discovery, stable schema-versioned Tool IDs, local `tools/call` forwarding and hot reload
- MCP tool projection deduplicates logical tools, requires an explicit model-selected Node for
  device execution and restricts each target enum to granted devices advertising that capability
- Dynamic Provider tools use their original JSON Schema, default to execution risk, require
  idempotency and remain unavailable until explicitly selected in an Agent grant
- Visual-first public site with a live execution topology, routed use-case map, layered architecture,
  permission intersection, dispatch lifecycle, data boundaries, security disclosures and staged roadmap
- Public documentation center with quickstart, use cases, concepts, architecture, Connector,
  integrations, tool, security, self-hosting, troubleshooting, roadmap and changelog sections
- Route-level prerendering for 21 public pages with canonical metadata, Open Graph, JSON-LD,
  sitemap, robots policy, RSS and `llms.txt` discovery resources
- Typed bilingual product updates, engineering articles, use cases, privacy and telemetry pages
- Opt-in hosted Plausible analytics with a fixed onboarding event catalog, normalized page paths,
  GPC/DNT enforcement and no analytics configuration in self-hosted defaults
- Source-mapped architecture diagrams for system context, pairing, invocation, authorization,
  dispatch state, idempotency, data ownership and current/planned boundaries
- Account overview with setup progress, device health, active Agent/client counts, approvals and activity
- `/app` Overview, Devices, optional Projects/Roots, Agent access, Approvals, Activity and Settings
- 702 typed translations, persisted language preference, locale-aware dates and old-route compatibility
- Separate internal CLI login and scoped connection credentials; stdio MCP cannot inherit
  account-management access
- Same-origin local startup, public HTTPS Compose and loopback override, health and protected metrics
- Downloadable macOS/Linux arm64/x64 clients with bundled Node.js and dependency license notices
- Conventional curl installer, integrity verification, persistent pairing, reinstall upgrades and
  launchd stale-registration recovery
- Explicit `adc update --check` / `adc update` with build-ID comparison, saved release source,
  checksum verification, atomic activation and service-restart rollback
- User launchd/systemd service generation and start/stop/restart/status/logs/uninstall commands
- Exact-ID-confirmed local unpair for replacing deleted devices while retaining durable receipts
- Console installation command, separate CDN/release origin and automatic device presence refresh

## Verified

- 126 passing tests across 29 files on Node.js 22; one opt-in macOS service test skipped (127 total)
- Real PostgreSQL migration, concurrent `SKIP LOCKED` claims and restart persistence
- Pairing/replay/revoke behavior
- Symlink escape, secret redaction, command denial, timeout/cancel and output limits
- Node restart plus lost completion request without duplicate side effects
- Artifact upload/download
- CLI and official MCP SDK parity
- End-to-end Agent MCP → Control Plane → Node → local MCP Provider execution and receipt persistence
- Two-user API isolation, persisted login/restart, verification, password reset and session invalidation
- CLI password fallback/access-key import via real HTTP and child process; mode-0600 storage and
  authority separation
- CLI device authorization request, browser confirmation, one-time redemption and independent logout
- OAuth PKCE/audience, refresh, revoke, reconnect and stale-code denial
- GitHub private verified email, state/replay, callback origin, disabled signup, explicit linking and MCP continuation
- Direct device CLI/Skill/official MCP parity, new all-folder discovery and fixed-folder restrictions
- Real PostgreSQL management E2E: account/CSRF boundaries, revision conflicts, MCP visibility,
  same-token authorization edits, OAuth continuity, deletion invalidation and name reuse
- Device deletion cancels work while retaining completed receipts; grant deletion denies pending
  approvals and removes inactive credentials/connections from management lists
- Live connector scope addition/removal, no-folder pairing, full trust and repeat-install scope preservation
- Concurrent create-only publication, hidden template roots, symlink aliases to protected files
- Expired invocation terminal results, completed-receipt replay after expiry, shutdown and lease loss
- Console production build
- Both-language React rendering, 702 catalog/placeholder checks, public/docs/console links, auth
  pages, pre-filled management forms, unavailable scopes and deletion dialogs
- Production entry HTTP smoke: built assets/CSP, login routes, anonymous API denial and OAuth discovery
- Production dependency audit against npmjs: no known vulnerabilities after updating Nodemailer/Vitest
- All four client archives built with verified official Node.js 24.21.0 runtime downloads
- Installed macOS arm64 client over real HTTP: pairing, online presence, scoped CLI file read,
  repeat installation, identity preservation, corrupt-download rejection, reconnect and uninstall
- Installed launchers work with no Node.js/pnpm on PATH and paths containing shell metacharacters

## Deployment verification

The hosted preview at `https://adc.47-101-150-8.nip.io:8443` runs the same application under systemd
with an isolated PostgreSQL database and Caddy TLS routing. Public health, static assets, OAuth
metadata, account registration, authenticated session persistence across an application restart,
and all four downloadable Connector archives have been verified against that deployment.

Compose configuration and Dockerfile are provided, but container image startup is not yet included
in the deployment verification above. SMTP delivery must be verified with the installation's actual
provider. GitHub tests simulate the provider's HTTP endpoints and use real
authentication/PostgreSQL; real GitHub consent requires the deployment's OAuth App credentials and
callback configuration. The hosted preview leaves password recovery, email verification and GitHub
login disabled until those integrations are supplied.

The current sandbox rejects `launchctl` execution with EACCES, so the actual macOS service-manager
test is opt-in (`ADC_TEST_LAUNCHD=1`) and was not passed here. macOS x64 and Linux arm64/x64 archives
are built and checksummed; executing those Connector packages and their Linux systemd lifecycle
remains to be verified on their respective hosts. Native database/installation suites run
sequentially to prevent archive compression and PostgreSQL startup from starving short-lease tests.

## Not implemented

- CIMD and named third-party MCP client interoperability certification
- Keychain/keyring-backed Node key storage
- Linux container hard-isolation profile
- S3-compatible artifact adapter, account storage/compute quotas and retention jobs
- Signed release packages, differential downloads and an unattended automatic updater
- Automated backup/restore tooling and external penetration test (manual operations are documented)
- Team roles, enterprise SSO/SCIM and billing
- Windows Node

These limits are common to both deployment forms. They do not create an unauthenticated self-hosted
edition. See [ADR-0005](adr/0005-one-product-identity.md) and [deployment operations](deployment.md).
