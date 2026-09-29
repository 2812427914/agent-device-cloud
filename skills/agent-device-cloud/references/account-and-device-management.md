# Account And Device Management

Load this reference only when the user asks to pair or remove a device, change access, manage
connections, inspect account audit, update ADC, or change the local Connector.

## Authority Separation

`adc status --json` reports two independent identities:

- `login` is the owner session used for account management.
- `connection` is the scoped Agent credential used for tool invocation.

Never substitute one for the other. If owner login is required, ask the user to run:

```bash
adc login --url https://installation.example
```

The browser displays a short-lived code. Do not request the user's password, browser cookie, access
key, or device private key.

## Pair A Device

Inspect existing state before creating anything:

```bash
adc device list --json
adc access list --json
adc connection list --json
```

Create a one-time installation command:

```bash
adc device add --name "Work Mac" --ttl 600 --access none --json
```

Return the generated `installCommand` to the user, or run it only through a channel the user already
authorized. Do not expose a folder by default. Wait for the selected device without inventing a
replacement:

```bash
adc device wait "Work Mac" --timeout 120 --json
adc device show "Work Mac" --json
```

## Create Least-Privilege Access

Start with read-only access to explicitly selected devices and folders:

```bash
adc access create \
  --name "Repository reader" \
  --devices "Work Mac" \
  --folders "/Users/example/work/project" \
  --capabilities read \
  --approval never \
  --json
```

Add write or execution only when the requested workflow requires it:

```bash
adc access update "Repository reader" \
  --capabilities run \
  --profile workspace-write \
  --approval writes \
  --json
```

Use `--tools` instead of a capability preset when the user requests an exact tool set. Projects are
optional grouping and placement. Do not create one for a direct device workflow.

Connect the local CLI without printing its generated credential:

```bash
adc connect "Repository reader" --name "Agent workspace" --expires 30 --json
adc status --json
```

Prefer names in commands shown to a user and stable IDs in stored automation. Never widen access as
a response to `denied`; explain which layer denied the request and let the user choose.

## Destructive Management

Run `revoke` or `remove` only after an explicit user request. The required `--yes` is confirmation,
not permission:

```bash
adc connection revoke CONNECTION_ID --yes --json
adc access revoke ACCESS_ID --yes --json
adc device revoke DEVICE_ID --yes --json
```

Do not approve an invocation initiated by this Agent. An independent user may use the Console or:

```bash
adc approval list --json
adc approval approve APPROVAL_ID --json
adc approval deny APPROVAL_ID --json
```

## Local Connector Changes

Run these only on the device being configured and only after an explicit user request:

```bash
adc-node access
adc-node roots list
adc-node templates list
adc-node mcp list
```

Use `adc-node --help` for mutation syntax. Cloud policy can narrow locally exposed capability but
cannot expand it. Never change local configuration through remote `shell.exec`, and never edit
Connector identity or state files directly.

## Updates

Check first:

```bash
adc update --check --json
```

Run `adc update` only when the user asks or has delegated routine maintenance. Do not update while
device work is active because activation restarts the Connector. Re-run `adc status --json`,
`adc node list --json`, and `adc tool list --json` after the update.
