# Windows node

## Supported scope

The first native Windows release targets 64-bit Windows 10 and Windows 11 on local NTFS volumes.
It bundles Node.js, executes commands with Windows PowerShell 5.1, and runs the Connector as a
least-privilege Scheduled Task for the current user.

The release supports pairing, selected/home/system-drive roots, file tools, PowerShell execution,
command templates, local MCP Providers, background startup, status/log/start/stop/restart,
`adc update`, key rotation, unpair and uninstall.

The following are deliberately outside this first release:

- Windows on ARM64
- UNC and mapped network roots
- a machine-wide Windows Service
- code-signed installers and executables
- Windows Sandbox or AppContainer isolation
- Job Object enforcement for descendants that intentionally detach from their parent

Cancellation and timeouts use `taskkill /T /F` to terminate the normal child-process tree. The
Connector still runs with the signed-in user's operating-system permissions. ADC policy and
approvals reduce authorized scope; they are not an OS sandbox.

## Install

In **Devices → Pair device**, select **Windows PowerShell**, copy the generated command and run it
in Windows PowerShell. Administrator privileges are not required. The installer uses
`Invoke-WebRequest`, `Expand-Archive` and `Get-FileHash`, all included in supported Windows
PowerShell versions.

Default locations:

| Purpose                               | Path                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| Versioned program files               | `%LOCALAPPDATA%\Programs\AgentDeviceCloud`             |
| `adc.cmd` and `adc-node.cmd`          | `%LOCALAPPDATA%\AgentDeviceCloud\bin`                  |
| Device identity and configuration     | `%LOCALAPPDATA%\AgentDeviceCloud\config\node.json`     |
| Receipts and temporary execution data | `%LOCALAPPDATA%\AgentDeviceCloud\config\state`         |
| Connector log                         | `%LOCALAPPDATA%\AgentDeviceCloud\config\logs\node.log` |

The installer prints the launcher directory when it is not already on `PATH`. Run commands by full
path until that directory has been added to the user `PATH`.

## Path and shell contract

Windows physical paths stay on the Node. Agents address files with a stable root ID and POSIX-style
relative path:

```json
{
  "rootId": "root_workspace",
  "path": "src/index.ts"
}
```

Do not send `C:\workspace\src\index.ts` through the API's absolute-path convenience form; that form
remains POSIX-only. Add Windows roots locally:

```powershell
adc-node roots add 'D:\work\project' --label Project
adc-node roots list
```

`shell.exec` and command templates use PowerShell syntax on native Windows. WSL uses Bash and is
registered as a separate Linux node.

## Native validation checklist

Before calling a build Windows-certified, test it on both a current Windows 10 x64 and Windows 11
x64 machine:

1. Run the generated command as a standard user with no Node.js or curl on `PATH`.
2. Pair with `none`, then add a local root containing spaces and non-ASCII characters.
3. Exercise `file.list`, `file.read`, `file.write`, `file.edit`, `file.patch` and `file.search`.
4. Run successful, non-zero, timed-out and cancelled PowerShell commands, including child
   processes.
5. Add one stdio MCP Provider and call one discovered tool.
6. Verify `status`, sign-out/sign-in startup, sleep/wake reconnection, `stop`, `start`, `restart` and
   `logs`.
7. Run `adc update --check`, upgrade, confirm identity/roots/receipts are unchanged, and test a
   deliberately corrupted archive.
8. Run `unpair` and `uninstall`; verify device state is preserved by uninstall and the Scheduled
   Task and program files are removed.
