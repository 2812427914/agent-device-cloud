# ADR-0005: One product for hosted and self-hosted deployments

Status: accepted, supersedes the M2 shared Owner Token authentication.

Both deployments run the same application, database schema, login pages, account isolation,
authorization, CLI and MCP integrations. Hosting is an operational choice, not an authentication
feature tier. No shared owner bearer or anonymous administration remains.

## Identity

- Better Auth owns email/password authentication, password reset, verification and revocable
  HttpOnly cookie sessions in PostgreSQL.
- Each user owns a personal ADC account. Account IDs come from the authenticated principal.
- Browser sessions authorize account administration. Agent API tokens are hashed, expiring,
  revocable and bound to one grant; they cannot create grants, pair devices or approve their work.
- MCP uses the OAuth 2.1 provider with PKCE and resource audience validation. Each authorization
  is associated with an explicit device/root/capability grant.
- CLI supports user login and importing scoped Agent credentials; it never stores device keys.
- Devices still authenticate with Ed25519 proof. Pairing resolves the account from a consumed
  pairing record, not a server-wide default.

## Isolation and persistence

All resource reads and mutations check account ownership before accessing or changing state.
Dispatch deduplication includes account, actor, target and input. Approval and enqueue must commit
atomically. Revocation is checked at dispatch/ACK as well as invocation submission.

PostgreSQL is required for the running application. In-memory stores are test fixtures only.
Versioned, locked migrations preserve existing tool history. Unclaimed legacy accounts require
an explicit local database administration action; public registration never claims their data.

## User experience

The public entry is a login/register page. After login, the user pairs a device, binds a project,
grants an Agent access, and reviews tasks, approvals and receipts. Internal account IDs are not
required in normal forms. Setup supplies origin, authentication secret and database; SMTP and
external identity providers are deployment integrations using the same code.
