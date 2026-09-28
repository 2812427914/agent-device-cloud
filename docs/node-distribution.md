# Device client installation and distribution

## User experience

In **Devices → Pair device**, copy the command and paste it into the terminal of the device to
connect. The short-lived code is used once. The installer detects the operating system and CPU,
downloads and verifies the release, asks for a name and access mode, and starts the device service.
Pairing does not require a directory: choose selected folders, home, full trust, or decide later.

```sh
curl -fsSL https://devices.example.com/install.sh | sh -s -- \
  --url https://devices.example.com --code 'PAIRING_CODE'
```

For unattended setup, add `--label my-device --access none|home|full`, or
`--label my-device --root-path /absolute/workspace`. The default folder ID
is `root_workspace`; `--root-id root_other` overrides it. `--read-only` prevents write/execution
permissions on this folder. The private device key stays on the device; exposed physical paths are
advertised to the control plane for authorization, approval and audit review. In **Agent access**,
choose the device, use its exposed folders, and choose capabilities and approval policy. No project
or duplicate physical path entry is required. All-folder grants include future folders;
selected-folder grants do not expand automatically.

After the first installation, use `adc update --check` and `adc update`. The update command reads
the saved release source, compares build IDs, downloads and verifies the current platform archive,
then reuses the installer without consuming a pairing code. Pairing, folders and receipt state are
preserved. `--download-url` can override the saved source, and `--no-service` is available for
foreground or isolated installations. Pairing to a different server is refused.
The installer serializes upgrades with a PID lock. If an earlier process was interrupted, the next
run automatically removes the stale lock; a live installer PID is never interrupted.
On macOS, startup falls back to loading the new plist if a stale launchd registration disappears
between inspection and restart. A failed service restart restores the previous active release.
If the server accepted pairing but local key persistence failed, retry with a fresh pairing code and
the same device name. A never-online incomplete record is replaced automatically.
Manage local scope without restarting or pairing again:

```sh
adc-node roots add "/path/to/workspace" --label Workspace
adc-node roots add "/path/to/docs" --read-only
adc-node roots list
adc-node roots remove root_id
adc-node templates add test --root root_id --command "pnpm test"
adc-node templates list
adc-node templates remove test --root root_id
adc-node mcp list
adc-node access home
adc-node access full
adc-node access none
```

`roots add` in none/selected mode preserves existing selected folders. Switching from home/full to
selected folders should first use `adc-node access none`, then add the intended directories.
`access full` uses current OS-user permissions without ADC's command/protected-file filtering; it
does not elevate privileges. Approval and Agent capabilities remain separate. Template changes made
with `adc-node templates add|list|remove` reload automatically. Invalid config prevents new work;
removing/downgrading access cancels affected running work.
Updates preserve roots/access even if an old installation command contains stale directory flags.

Local MCP Providers are managed with `adc-node mcp add|list|remove`. Stdio Providers receive
arguments through `--args`; secrets must be loaded from a mode-0600 JSON file with `--env-file`.
Streamable HTTP Providers use `--http` and optional `--headers-file`, and require HTTPS except on
loopback. Provider configuration and credentials remain local; only discovered tool contracts are
advertised. Changes reload automatically.
For an already paired device on the local preview, upgrade without a new code:

```sh
curl -fsSL http://localhost:8787/install.sh | sh -s -- --url http://localhost:8787
```

Use `adc-node status`, `logs`, `stop`, `start`, `restart`, `rotate-key` and `uninstall`.
After deleting a device in the console, run `adc-node unpair --confirm <old-node-id>` locally before
pairing it again. This stops the user service, removes the old private identity and preserves the
receipt state directory. Exact node-ID confirmation prevents accidental unpairing.

Programs install in `~/.local/share/agent-device-cloud`, with launchers in `~/.local/bin`.
The installer prints a PATH instruction if needed; it does not rewrite shell profiles.
macOS uses a LaunchAgent for the signed-in user. Linux uses `systemd --user`; use
`loginctl enable-linger USER` through an administrator when service operation across logout is
required. Suspend pauses execution; after wake, the existing reconnect/lease protocol resumes.
Services inherit the installation terminal's PATH so locally installed development tools remain
available. Re-run installation after changing that PATH.

`adc-node uninstall` removes its program and service and preserves `~/.config/adc/`, which also
contains the CLI's separately scoped credentials. Revoke the device and unused Agent tokens in
the console when retiring them. Stop any manually started foreground daemon before uninstalling.
Old versioned program directories remain until uninstall; they can be removed after confirming they
are not the target of `current` and no old process is running.

## Publish on your own domain, CDN or GitHub Releases

Build all four supported archives with a pinned official Node.js runtime:

```sh
pnpm install --frozen-lockfile
pnpm build:node --download-url https://downloads.example.com/adc/v0.1.0
```

Upload the contents of `dist/node/` unchanged to that directory:

- `install.sh`: generated installer with the download base URL and archive checksums embedded.
- `adc-<version>-<platform>-<arch>-<digest>.tar.gz`: runtime, CLI, daemon and license notices.
- `manifest.json`: version, build ID, runtime, file names, sizes and SHA-256 values.
- `SHA256SUMS`: archive checksums for manual verification.

Then the public command is:

```sh
curl -fsSL https://downloads.example.com/adc/v0.1.0/install.sh | sh -s -- \
  --url https://devices.example.com --code 'PAIRING_CODE'
```

For GitHub Releases, build with the immutable base
`https://github.com/OWNER/REPO/releases/download/v0.1.0`, then attach all output files to that release.
The repository contains the build script, but does not publish files or create a release for you.
Keep old archives accessible while cached installers may still reference them.

Set `ADC_NODE_DOWNLOAD_URL` on the Control Plane to the published directory and restart it. The
console will generate commands using that external installer and archive base. This setting declares
the external release available; verify the uploaded URL before enabling it.

Without a build-time base URL, pass `--download-url https://downloads.example.com/adc/v0.1.0` to the
installer. Without either override, it uses `--url ORIGIN` plus `/downloads/node`.
Download URLs use HTTPS; loopback HTTP supports local development.

Build only a selected platform for development with `--targets darwin-arm64`. `--out-dir PATH`
chooses a separate build output directory. The full release uses `darwin-arm64`, `darwin-x64`,
`linux-arm64` and `linux-x64`. Linux requires glibc; Alpine/musl and Windows are not supported.
Minimum OS requirements follow the pinned Node.js 24 runtime (macOS 13.5+, glibc 2.28+).

Official runtime URLs and SHA-256 values are committed in `deploy/node-runtime.json`. Update the
version, all four hashes and release validation together when taking Node security updates.
Archive hashes verify integrity; HTTPS establishes the distribution origin. `adc update` is
explicit and downloads the complete runtime-containing archive. Detached signatures, differential
packages and unattended updates are not included.

## Serve releases with the Control Plane

`pnpm build:node` produces `dist/node`; the Control Plane serves:

- `/install.sh` and `/downloads/node/install.sh`
- `/downloads/node/manifest.json`
- `/downloads/node/SHA256SUMS`
- `/downloads/node/<archive-name>`

Missing downloads return HTTP 404. No account session is required to download program files; pairing
still requires a valid code. `ADC_NODE_RELEASE_DIR` changes the local serving directory. Docker builds
all four archives into the image so the standard Compose installation has a working Pair device flow.

For local use:

```sh
curl -fsSL http://localhost:8787/install.sh | sh -s -- \
  --url http://localhost:8787 --code 'FRESH_CODE_FROM_CONSOLE'
```

## Validation

`pnpm exec vitest run tests/install.e2e.test.ts` builds an archive for the current platform and uses
an isolated real PostgreSQL account over HTTP. It installs from the served script with no Node.js or
pnpm on PATH, pairs, runs a real daemon, imports an access key, reads a local file through the
installed CLI, checks and performs an `adc update`, verifies identity preservation, rejects a
corrupted download, reconnects and uninstalls. Paths include whitespace and shell metacharacters.
It does not change the user's HOME, normal configuration or existing pairing.

The actual macOS service-manager check is opt-in because sandboxed development environments may
deny execution of launchctl:

```sh
ADC_TEST_LAUNCHD=1 pnpm exec vitest run tests/install.e2e.test.ts
```

It uses an isolated service file under the workspace and removes its launchd job on completion.
Linux systemd runtime validation requires a Linux login session with an active user manager.
For isolated/manual foreground testing, set absolute `ADC_INSTALL_DIR`, `ADC_BIN_DIR` and
`ADC_NODE_CONFIG` paths, pass `--no-service`, then run the installed `adc-node run`.
`ADC_SERVICE_DIR` is available for isolated macOS service tests.
