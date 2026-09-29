# Security Policy

## Supported versions

Agent Device Cloud is currently a `0.1` pre-release. Security fixes target the latest `main` revision
and the current hosted preview. Older commits and private forks do not receive backported fixes.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/zionforge/agent-device-cloud/security/advisories/new).
If that form is unavailable, contact the repository owner privately through GitHub before sharing
technical details.

Include affected versions, impact, minimal reproduction steps and any known mitigations. Do not
include device credentials, access keys, session cookies, private file content or production URLs.
Use synthetic data and redact environment-specific identifiers.

The maintainers aim to acknowledge a report within three business days, provide an initial severity
assessment within seven business days and coordinate disclosure after a fix is available. Timelines
may change when a fix requires protocol, migration or Connector release work; the reporter will
receive an updated plan rather than public disclosure before users can mitigate the issue.

## Scope

Security-sensitive areas include:

- authentication, account isolation and OAuth binding;
- Agent grants, approval and revocation behavior;
- Connector signatures, nonce replay protection and key storage;
- path containment, process execution and output redaction;
- dispatch leases, idempotency, receipts and unknown outcomes;
- accidental telemetry or logging of private product data.

The documented limitations in `docs/threat-model.md` are not automatically vulnerabilities. Reports
that show a stated guardrail can be bypassed, a boundary behaves differently from its documentation,
or a limitation creates a practical exploit are in scope.
