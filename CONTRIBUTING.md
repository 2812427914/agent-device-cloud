# Contributing

Agent Device Cloud accepts focused bug fixes, tests, documentation and integrations. Start by
describing the user problem and the boundary affected by the change. For new behavior or public
contracts, open an issue before investing in a large implementation.

## Development setup

Use Node.js 22+, pnpm 9+ and PostgreSQL 16+. Copy `.env.example` to `.env`, generate a stable
`ADC_AUTH_SECRET`, and set `ADC_REQUIRE_EMAIL_VERIFICATION=false` when SMTP is unavailable locally.

```bash
pnpm install --frozen-lockfile
pnpm build:node
pnpm dev
```

The application is served at `http://localhost:8787`. For console hot reload, set
`ADC_PUBLIC_URL=http://localhost:5178`, run `pnpm --filter @adc/console exec vite` beside the API,
and use the Vite URL so authentication remains same-origin.

## Repository boundaries

- `packages/protocol`: versioned invocation, capability, result and receipt contracts.
- `packages/policy`: authorization intersection and explainable decisions.
- `packages/tool-runtime`: device-side validation, execution and durable receipts.
- `packages/client`: typed owner, Agent and Connector clients.
- `apps/control-plane`: identity, management APIs, dispatch, audit and public serving.
- `apps/node`: local configuration, wake connection, execution and user-service lifecycle.
- `apps/console`: public website, documentation and account UI.
- `tests`: cross-boundary, PostgreSQL and installation behavior.

Keep protocol, policy and receipt behavior independent of MCP, CLI and other adapters. A transport
adapter must not become the source of truth for authorization or task state.

## Change requirements

- Security controls fail closed.
- Protocol changes update committed JSON Schema and compatibility vectors.
- Trust-boundary or delivery-semantics changes include an ADR.
- New side-effecting tools include a durable idempotency strategy and terminal receipt tests.
- Database changes use additive, locked migrations and include real PostgreSQL coverage.
- User-visible behavior includes concise English and Simplified Chinese copy.
- Self-hosted builds must not gain an external telemetry destination by default.

## Verification

Run the focused test while developing. Before submitting a pull request, run:

```bash
pnpm schema:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm audit --prod
```

Integration tests start disposable PostgreSQL processes and may be slower than unit tests. Use
Node.js 22 and `LANG=C LC_ALL=C` if the host locale prevents PostgreSQL initialization. Installation
tests build platform archives; the launchd lifecycle check is opt-in with `ADC_TEST_LAUNCHD=1`.

## Pull requests

Keep commits reviewable and avoid unrelated formatting or refactors. The pull request should state:

1. The user-visible problem and resulting behavior.
2. The trust, compatibility or migration impact.
3. The exact verification performed.
4. Documentation or release-note changes when a public contract changed.

Never include credentials, private file content or production URLs in an issue, fixture or log.
Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md).
