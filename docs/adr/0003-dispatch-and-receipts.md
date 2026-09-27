# ADR-0003: At-Least-Once Dispatch and Durable Receipts

- Status: accepted
- Date: 2026-09-24

## Decision

PostgreSQL dispatch uses `FOR UPDATE SKIP LOCKED`, expiring leases and explicit ACK. Delivery is
at-least-once. Every side effect therefore requires an actor-scoped idempotency key.

Before execution, the Node atomically persists a `started` ledger entry. After execution it
atomically replaces that entry with the terminal Result and immutable Receipt. A repeated key with
identical input replays the receipt. A repeated key with different input is a conflict. A surviving
`started` entry without a terminal record returns `unknown_outcome` and is never executed again
automatically.

## Consequences

- Lost ACKs and HTTP responses do not duplicate known side effects.
- Exactly-once execution is not claimed.
- Operators must reconcile `unknown_outcome`; generating a new key without reconciliation is unsafe.
- Terminal database states cannot regress when a late or duplicate receipt arrives.
