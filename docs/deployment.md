# Deployment and operations

Hosted and self-hosted run the same image and migrations. No default user, shared owner password or
anonymous administration endpoint is created. Use the [README](../README.md) for initial setup.

## Configuration

| Variable                                           | Meaning                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                     | Required PostgreSQL connection; Compose constructs this from its database password         |
| `ADC_PUBLIC_URL`                                   | Exact public origin for cookies, CSRF checks, email callbacks and OAuth audience           |
| `ADC_AUTH_SECRET`                                  | Stable random secret, at least 32 characters; keep with encrypted backups                  |
| `ADC_REGISTRATION_ENABLED`                         | `false` closes new email and GitHub registrations; existing logins continue                |
| `ADC_REQUIRE_EMAIL_VERIFICATION`                   | `true` requires verification before login and requires SMTP                                |
| `ADC_SMTP_URL`, `ADC_SMTP_FROM`                    | Nodemailer SMTP transport and verified sender address                                      |
| `ADC_OAUTH_DYNAMIC_REGISTRATION`                   | `true` allows MCP OAuth client registration; consent and a valid grant remain required     |
| `ADC_GITHUB_CLIENT_ID`, `ADC_GITHUB_CLIENT_SECRET` | Optional GitHub OAuth App credentials; both required to enable GitHub login                |
| `ADC_TRUSTED_PROXIES`                              | Comma-separated proxy addresses/CIDRs; never trust all public client addresses             |
| `ADC_CONSOLE_DIR`                                  | Optional built console path; defaults to `apps/console/dist`                               |
| `ADC_NODE_RELEASE_DIR`                             | Local downloadable client directory; defaults to `dist/node`                               |
| `ADC_NODE_DOWNLOAD_URL`                            | Optional external release directory on a static website/CDN/GitHub Releases                |
| `HOST`, `PORT`                                     | Default API bind is `127.0.0.1:8787`; Compose uses its private network                     |
| `ADC_NODE_CONFIG`                                  | Local device configuration override                                                        |
| `ADC_CONFIG`                                       | Local CLI token configuration override; management session uses a separate `.session` file |

Use one hostname consistently. Changing the public origin invalidates existing OAuth audiences and
requires reconnecting clients. Behind an existing reverse proxy, configure TLS there, forward to the
private API port, preserve the host, and replace forwarded client-address headers. Configure only that
proxy's addresses in `ADC_TRUSTED_PROXIES`.

Public signup creates isolated personal accounts. It does not create a site-wide administrator.
For a private installation, create the intended accounts and then disable registration. SMTP must
work before enabling mandatory verification. Password reset stays disabled when no transport is set.

## GitHub and website

`/` serves the public landing page, `/docs` the public documentation center, `/login` the shared
authentication flow, and `/app` the account overview. Older `/devices`, `/agents`, `/projects`,
`/access`, `/audit`, `/settings` URLs redirect to their `/app` equivalents. English and Simplified
Chinese cover the shared UI; language preference is stored locally.

Create an OAuth App in GitHub developer settings. Set **Homepage URL** to `ADC_PUBLIC_URL` and
**Authorization callback URL** to `${ADC_PUBLIC_URL}/api/auth/callback/github`. For the native local
preview use `http://localhost:8787/api/auth/callback/github`; for the loopback Compose override use
`http://localhost:8088/api/auth/callback/github`. Use separate OAuth Apps for different deployments.
Set both credentials in `.env` and restart the Control Plane; Compose forwards them to the server.
Partial configuration fails startup. No credentials appear in `/api/v1/auth/config` or the client
bundle, and the button stays hidden when unconfigured.

Better Auth performs state, cookie, code exchange, and verified email lookup against GitHub.
The server also requires same-origin social-login requests and callback URLs. Provider tokens are
encrypted at rest with the stable auth secret. GitHub login requires a verified email even when
local email verification is optional. New GitHub users cannot bypass disabled registration.

Verified local users can use their matching GitHub email; unverified email users first sign in
normally and explicitly connect GitHub under Account. Different email addresses are not linked.
GitHub-only users can add a password through SMTP password reset when enabled. Social login is
separate from ADC's MCP OAuth provider; either login method can continue MCP's signed consent flow.
Local automated tests simulate GitHub endpoints and exercise real account/session persistence.
Finish a real GitHub consent round trip after supplying your OAuth App credentials.

## Resource lifecycle

Device and Agent authorization edits use revision numbers. A stale browser receives HTTP 409 instead
of overwriting a newer change. Management mutations require a same-origin owner session; Agent
credentials cannot edit their own access. Device cloud limits only narrow the capability advertised
by the connector. See [resource management](resource-management.md) for the API and lifecycle.

Revocation retains the record; deletion hides it while retaining the database row for dispatch,
receipt and audit references. Grant deletion invalidates associated credentials and OAuth bindings.
Device deletion revokes its identity and frees its display name. Backups therefore retain deleted
resource metadata until a future retention policy removes it.

## Health and shutdown

- `/health`: database readiness, HTTP 503 when PostgreSQL is unavailable.
- `/metrics`: authenticated process, HTTP, invocation and polling metrics; use an authorized user
  session over a protected operations channel. Agent tool tokens cannot access installation metrics.
- Reverse proxies must pass WebSocket upgrades for `/api/v1/nodes/:nodeId/events`. Wake signals are
  best-effort only; the Connector immediately polls after reconnect and retains a 30-second fallback.
- `adc_node_wake_connections` reports active authenticated wake sockets.
  `adc_node_wake_total{outcome="attempted|offline"}` distinguishes send attempts on open sockets
  from durable work queued while a Connector was disconnected.
- Control Plane logs are JSON. Do not enable request-body or authorization-header logging upstream.
- SIGTERM/SIGINT drains HTTP and closes PostgreSQL. Node shutdown cancels its active process and
  attempts to upload the durable terminal receipt. On reconnect, expired leases reconcile receipts.

The downloadable client installs a user launchd/systemd service. Use `adc-node status`, `logs` and
`restart` to inspect it; repeat the install command to upgrade while preserving identity and receipts.
Linux operation across logout requires user lingering. The source `adc-node run` command still runs
in the foreground. Keep its state directory on persistent local storage, mode 0700, with config and
ledger files mode 0600. See [client distribution](node-distribution.md) for publishing downloads.

## Backup and restore

Back up the whole ADC database: it includes users, password hashes, sessions, OAuth token state,
pairing records, grants, dispatches, audit and current artifact blobs. Also back up `.env` securely
and preserve device configurations/receipt state on their respective devices. Do not upload device
private keys to the control plane.

Example database backup, from the repository directory:

```bash
docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \
  pg_dump -U adc -d adc -Fc > adc-backup.dump
```

Encrypt this file and restrict access. Check its archive before relying on it:

```bash
docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \
  pg_restore --list < adc-backup.dump
```

Rehearse restore into a **new, empty database**, not the running database:

```bash
docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \
  createdb -U adc adc_restore_check
docker compose --env-file .env -f deploy/compose.yaml exec -T postgres \
  pg_restore -U adc -d adc_restore_check --exit-on-error < adc-backup.dump
```

Verify row counts and use an isolated application instance to verify sign-in, grants and audit.
Restoring database state can resurrect credentials revoked after the backup; rotate affected access
and re-pair devices when recovering from a security incident.

## Upgrade

1. Record the running source revision/image digest and take a verified database backup.
2. Build the new image, then recreate the Control Plane. ADC SQL migrations and Better Auth migrations
   acquire PostgreSQL advisory locks before HTTP starts.
3. Check `/health`, sign in, verify device presence, and execute a permitted read.
4. Retain the previous image and backup until the installation is verified. Do not run old application
   code against an incompatible new schema. Rollback may require restoring the pre-upgrade database.

Use `docker compose --env-file .env -f deploy/compose.yaml build` followed by
`docker compose --env-file .env -f deploy/compose.yaml up -d`. Include the local override for a
loopback installation. No published OCI image, automatic updater or downgrade migration is supplied.

## Migrating the early shared-token prototype

The old `ADC_OWNER_TOKEN` and installation-wide MCP context variables are no longer read.
Existing device/tool history remains in its original account. New public registrations never
automatically claim that data. A trusted database administrator must explicitly associate a legacy
account with a verified user; otherwise use a new account and re-pair devices. There is no public
bootstrap endpoint that grants control of old data.

## Current limits

Artifacts currently use PostgreSQL blobs, capped at 25 MiB each; account storage quotas, retention
jobs and S3 are not implemented. Monitor database size and disk usage. This release has one active
execution per foreground daemon, no OS-enforced CPU/memory/network sandbox, and no multi-region
service orchestration. The implementation tests run against real PostgreSQL; container image startup,
TLS issuance and SMTP deliverability must also be verified in the target deployment.
