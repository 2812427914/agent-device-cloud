# ADR-0002: Device Identity and Pairing

- Status: accepted
- Date: 2026-09-24

## Decision

A device generates an Ed25519 key pair locally and exchanges a one-time, short-lived pairing code
for a server-assigned Node ID. Every subsequent Node request signs method, path, timestamp, nonce and
canonical body hash. The control plane verifies the signature, timestamp, active node state and
single-use nonce before processing the request.

Private keys remain in a mode-0600 local Node configuration in M2. Production installers should use
macOS Keychain or a Linux keyring when available.

## Consequences

- Captured requests cannot be replayed.
- A credential cannot be copied to another key pair.
- Revocation is checked on every poll, ACK and receipt upload.
- Clock skew beyond five minutes fails closed and must be diagnosed by `adc node doctor`.
