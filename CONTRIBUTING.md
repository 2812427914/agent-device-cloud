# Contributing

Use Node.js 22+ and pnpm 9+. Keep protocol, policy and receipt behavior independent of MCP, CLI and
other adapters.

Before submitting a change:

```bash
pnpm schema:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Protocol changes require updated committed JSON Schema, compatibility vectors and an ADR when they
alter trust boundaries or delivery semantics. Security controls must fail closed. New side-effecting
tools require a durable idempotency strategy and terminal receipt tests.
