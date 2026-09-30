# ADR-0006: Installable device client

Status: accepted

An end user must be able to connect a device from the console without cloning this repository,
installing a package manager, or keeping a terminal open. Hosted and self-hosted installations
distribute the same client.

## Distribution

Build platform-specific archives for macOS arm64/x64, glibc Linux arm64/x64 and Windows x64. Bundle
an official, pinned Node.js runtime with the compiled device daemon and ADC CLI. Verify runtime
downloads against the SHA-256 values committed in `deploy/node-runtime.json`; include Node and
bundled dependency license notices. End-user installation does not download dependencies from npm.

The release manifest contains the version, supported targets, file sizes and archive hashes.
Control Plane serves the manifest, archives and installation script from its own origin. Archive
filenames include a content identity to avoid confusing rebuilt versions. The installer verifies the
archive before extraction. TLS authenticates the deployment's distribution origin; checksums detect
corruption and mismatched artifacts, not a compromised origin.

The same output directory can be published as static files on a website, CDN or GitHub Releases.
Use the conventional `curl -fsSL https://host/install.sh | sh -s -- --url ORIGIN --code CODE`
entry point on macOS/Linux and a generated `Invoke-WebRequest` plus `install.ps1` command on
Windows. Keep the download base URL separate from the paired Control Plane origin; release
generation and the console can configure the external download location without modifying daemon
authentication or requiring source installation.

## Installation and lifecycle

The console provides a copyable installation command with a short-lived pairing code. The installer
detects the platform, downloads the matching archive, and installs under the current user's home.
It installs `adc` and `adc-node` launchers without requiring root privileges.

Device setup asks for the local folder and device label, stores the Ed25519 identity in the user's
private configuration directory, and starts a user service. macOS uses launchd; Linux uses systemd
--user; Windows uses a least-privilege current-user Scheduled Task. Background restart belongs to
the OS service manager. Linux operation across logout requires a user manager with lingering;
report its actual availability rather than claiming system-wide boot persistence.

Windows uses ZIP because PowerShell provides `Expand-Archive`; it does not require curl, tar, a Unix
shell or a preinstalled Node.js. Windows physical paths remain local and are addressed over the wire
with a root ID plus POSIX-style relative path. Native Windows command execution is explicitly
PowerShell rather than a claim that Bash commands are portable.

Repeated installation preserves the device identity, authorized folders and receipt ledger.
Changing the paired account/origin requires an explicit action. Failed downloads or checksum
verification leave the existing installation intact. Upgrade switches the installed release while
retaining identity/state; stop, restart, status, logs and uninstall are available through the client.
Uninstall stops/removes the service and program launchers, preserves device state by default and
explains how to revoke the device in the console.

The installer must support isolated paths and a foreground/no-service mode for lifecycle E2E tests.
Tests exercise the built archive, actual HTTP pairing and daemon operations. Platform-specific
service-manager checks are reported separately from generated unit/plist validation.
