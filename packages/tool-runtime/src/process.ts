import { spawn, type ChildProcess } from "node:child_process";

export interface ShellInvocation {
  executable: string;
  args: string[];
  detached: boolean;
}

export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform
): ShellInvocation {
  if (platform === "win32") {
    const script = `[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$global:LASTEXITCODE = $null
& {
${command}
}
$adcSucceeded = $?
$adcExitCode = $LASTEXITCODE
if ($null -ne $adcExitCode) { exit $adcExitCode }
if (-not $adcSucceeded) { exit 1 }
`;
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")
      ],
      detached: false
    };
  }
  return {
    executable: "/bin/bash",
    args: ["--noprofile", "--norc", "-c", command],
    detached: true
  };
}

export function terminateProcessTree(
  child: ChildProcess,
  force: boolean,
  platform: NodeJS.Platform = process.platform
): void {
  if (!child.pid) return;
  if (platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
      { windowsHide: true, stdio: "ignore" }
    );
    killer.once("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
    return;
  }
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}
