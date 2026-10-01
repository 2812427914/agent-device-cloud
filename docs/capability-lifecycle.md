# Capability lifecycle direction

This document records a future direction. Except for the current local MCP Provider registry and
Android built-in capability registry, the package, catalog and rollout system below is not
implemented.

## Objective

A Node is a capability host, not a fixed list of methods tied to one operating system. ADC should
eventually support a governed lifecycle:

```text
develop -> contract-test -> publish -> review -> install -> grant -> invoke
        -> diagnose -> upgrade or roll back -> remove
```

Device-native primitives remain deliberately small. Agents and Providers may compose those
primitives, but an installed capability must never grant itself additional device authority.

## Capability forms

| Form                 | Intended host                       | Distribution model                          |
| -------------------- | ----------------------------------- | ------------------------------------------- |
| Native built-in      | Android, iOS, desktop               | Signed Node/App release                     |
| Declarative workflow | Mobile, desktop, gateway            | Signed data package over approved Host APIs |
| MCP Provider         | Desktop, server, gateway            | Local process or Streamable HTTP endpoint   |
| Sandboxed module     | Hosts with an approved WASM runtime | Signed content-addressed package            |
| Container Provider   | Hardened Linux hosts                | Signed image and pinned digest              |
| Remote Provider      | Control or service plane            | Account connection; no device installation  |

Native functionality such as location, camera, Bluetooth or OS notifications requires an
OS-specific implementation. A downloaded workflow can use an already exposed primitive; it cannot
create a new OS permission or entitlement.

## Package contract

A future package needs an immutable identifier and version, publisher identity, content digest,
runtime requirement, input/output schemas, Host API requirements, outbound network allowlist,
secret references, side-effect and idempotency declaration, resource limits, health check, tests and
upgrade/rollback metadata.

Compatibility must be capability-driven:

```text
Node advertises platform + runtimes + Host APIs + current availability
Package declares required runtime + Host APIs + minimum versions
Control Plane computes compatible targets
```

Do not branch the product around an ever-growing list of hard-coded Node classes.

## Authority separation

The same Agent must not silently gain all four authorities:

1. Create or modify a package.
2. Install it on a Node.
3. Grant the package access to device resources.
4. Invoke the resulting capability.

An Agent may propose a package and run isolated tests. Installation requires an owner or deployment
policy. Agent grants remain separate. New versions that add Host APIs, network destinations, secrets,
background execution or side effects require a new approval.

## Release evidence

The catalog should distinguish:

- source or publisher assertion;
- contract tests in simulation;
- installation on a real platform;
- scenario verification on named hardware and OS versions;
- maintained compatibility with a recent verification date.

Errors and receipts may support a Builder Agent proposing a new immutable package version. Live
packages are never modified in place. Promotion uses a canary and rollback target.

## Incremental delivery

1. Use the current MCP Provider registry as the first package source.
2. Stabilize the native Android capability registry and permission/availability model.
3. Define signed package metadata and a private catalog.
4. Add declarative workflows over a narrow Host API surface.
5. Add install, permission-diff, canary, upgrade, rollback and removal operations.
6. Consider sandboxed modules and public discovery only after real private-package usage.

The first Android Mobile Node intentionally ships before this lifecycle. It establishes the native
Host API boundary that future packages may safely compose.
