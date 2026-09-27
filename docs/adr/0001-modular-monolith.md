# ADR-0001: TypeScript Modular Monolith

- Status: accepted
- Date: 2026-09-24

## Decision

Use one pnpm TypeScript monorepo. Deploy the control plane as one Fastify process backed by
PostgreSQL. Keep protocol, policy, persistence, tool runtime, client and MCP boundaries as separate
packages. Ship the Device Node as a separate process.

## Consequences

- Protocol and adapters can evolve atomically.
- Dispatch and audit share one database transaction.
- Node execution remains outside the control-plane trust boundary.
- Redis, a message broker, microservices and Kubernetes require measured need before adoption.
