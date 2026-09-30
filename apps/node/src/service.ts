import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { configPath, loadConfig } from "./config.ts";

const exec = promisify(execFile);
const installDirectory = process.env.ADC_INSTALL_DIR;
const binDirectory = process.env.ADC_BIN_DIR;
const suffix = createHash("sha256").update(configPath).digest("hex").slice(0, 12);
const label = `com.agentdevicecloud.node.${suffix}`;
const unit = `adc-node-${suffix}.service`;
const taskName = `Agent Device Cloud Node ${suffix}`;
const logDirectory = resolve(dirname(configPath), "logs");
const systemdDirectory = resolve(
  process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"),
  "systemd",
  "user"
);
const serviceDirectory =
  process.env.ADC_SERVICE_DIR ??
  (process.platform === "darwin"
    ? resolve(homedir(), "Library", "LaunchAgents")
    : process.platform === "win32"
      ? resolve(dirname(configPath), "service")
      : systemdDirectory);
const serviceFile = resolve(
  serviceDirectory,
  process.platform === "darwin"
    ? `${label}.plist`
    : process.platform === "win32"
      ? `${suffix}.xml`
      : unit
);
const windowsRunner = resolve(serviceDirectory, `${suffix}.cmd`);
const domain = process.platform === "darwin" ? `gui/${process.getuid!()}` : "";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdString(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

function cmdString(value: string): string {
  return `"${value.replaceAll("%", "%%")}"`;
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function command(binary: string, args: string[]) {
  try {
    return await exec(binary, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(`${binary} ${args[0]} failed: ${detail.stderr?.trim() || detail.message}`);
  }
}

function installedPaths() {
  if (
    !installDirectory ||
    !binDirectory ||
    !existsSync(resolve(installDirectory, ".adc-installation"))
  ) {
    throw new Error("Use the installed adc-node launcher for service management.");
  }
  return { install: resolve(installDirectory), bin: resolve(binDirectory) };
}

function pathContains(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function windowsTaskRegistered(): Promise<boolean> {
  try {
    await exec("schtasks.exe", ["/Query", "/TN", taskName], {
      timeout: 10_000,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

async function windowsTaskState(): Promise<string> {
  const result = await command("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `(Get-ScheduledTask -TaskName ${powershellLiteral(taskName)} -ErrorAction Stop).State.ToString()`
  ]);
  return result.stdout.trim();
}

export function windowsTaskDefinition(runner: string, userId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Agent Device Cloud device connector</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger></Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT10S</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(runner)}</Command>
      <WorkingDirectory>${xml(dirname(runner))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export async function serviceStatus() {
  const registered =
    process.platform === "win32" ? await windowsTaskRegistered() : existsSync(serviceFile);
  let running = false;
  let detail = "";
  if (registered) {
    try {
      if (process.platform === "darwin") {
        detail = (await command("launchctl", ["print", `${domain}/${label}`])).stdout;
        running = /\bstate = running\b/.test(detail);
      } else if (process.platform === "linux") {
        detail = (
          await command("systemctl", ["--user", "show", unit, "--property=ActiveState,SubState"])
        ).stdout;
        running = detail.includes("ActiveState=active") && detail.includes("SubState=running");
      } else if (process.platform === "win32") {
        detail = await windowsTaskState();
        running = detail === "Running";
      }
    } catch (error) {
      detail = (error as Error).message;
    }
  }
  let node: { nodeId: string; controlPlaneUrl: string } | undefined;
  if (existsSync(configPath)) {
    const config = await loadConfig();
    node = { nodeId: config.nodeId, controlPlaneUrl: config.controlPlaneUrl };
  }
  return {
    paired: !!node,
    ...node,
    registered,
    running,
    configPath,
    serviceFile,
    logDirectory,
    ...(detail && !running ? { detail } : {})
  };
}

async function launchdLoaded(): Promise<boolean> {
  try {
    await exec("launchctl", ["print", `${domain}/${label}`], { timeout: 10_000 });
    return true;
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    if (/Could not find service/i.test(detail.stderr ?? "")) return false;
    throw new Error(`Cannot inspect launchd service: ${detail.stderr?.trim() || detail.message}`);
  }
}

export async function stopService(): Promise<void> {
  if (process.platform === "win32") {
    if (!(await windowsTaskRegistered())) return;
    await command("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Stop-ScheduledTask -TaskName ${powershellLiteral(taskName)} -ErrorAction SilentlyContinue`
    ]);
    return;
  }
  if (!existsSync(serviceFile)) return;
  if (process.platform === "darwin") {
    if (!(await launchdLoaded())) return;
    await command("launchctl", ["bootout", `${domain}/${label}`]);
  } else if (process.platform === "linux") {
    await command("systemctl", ["--user", "stop", unit]);
  }
}

export async function startService(): Promise<void> {
  if (process.platform === "win32") {
    if (!(await windowsTaskRegistered()))
      throw new Error("Background task is not installed. Run adc-node setup first.");
    await command("schtasks.exe", ["/Run", "/TN", taskName]);
    return;
  }
  if (!existsSync(serviceFile))
    throw new Error("Service is not installed. Run adc-node setup first.");
  if (process.platform === "darwin") {
    if (!(await launchdLoaded())) {
      await command("launchctl", ["bootstrap", domain, serviceFile]);
      return;
    }
    try {
      await command("launchctl", ["kickstart", `${domain}/${label}`]);
    } catch (error) {
      if (!/Could not find service/i.test((error as Error).message)) throw error;
      await command("launchctl", ["bootstrap", domain, serviceFile]);
    }
  } else if (process.platform === "linux") {
    await command("systemctl", ["--user", "start", unit]);
  }
}

export async function installService(): Promise<void> {
  const paths = installedPaths();
  await loadConfig();
  await mkdir(serviceDirectory, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const launcher = resolve(paths.bin, process.platform === "win32" ? "adc-node.cmd" : "adc-node");
  if (process.platform === "win32") {
    await stopService();
    const userId = (
      await command("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
      ])
    ).stdout.trim();
    await writeFile(
      windowsRunner,
      `@echo off\r\ncall ${cmdString(launcher)} run >> ${cmdString(resolve(logDirectory, "node.log"))} 2>&1\r\n`,
      "utf8"
    );
    await writeFile(serviceFile, windowsTaskDefinition(windowsRunner, userId), "utf8");
    await command("schtasks.exe", ["/Create", "/TN", taskName, "/XML", serviceFile, "/F"]);
  } else {
    const environment: Record<string, string> = {
      PATH: `${paths.bin}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
      ADC_NODE_CONFIG: configPath,
      ADC_INSTALL_DIR: paths.install,
      ADC_BIN_DIR: paths.bin,
      ADC_SERVICE_DIR: serviceDirectory
    };
    if (process.platform === "darwin") {
      await stopService();
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(launcher)}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict>${Object.entries(environment)
        .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
        .join("")}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(resolve(logDirectory, "node.log"))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(logDirectory, "node.log"))}</string>
</dict></plist>
`;
      await writeFile(serviceFile, content, { mode: 0o600 });
    } else if (process.platform === "linux") {
      const content = `[Unit]
Description=Agent Device Cloud device
After=network-online.target

[Service]
Type=simple
ExecStart=${systemdString(launcher).replaceAll("$", "$$")} run
${Object.entries(environment)
  .map(([key, value]) => `Environment=${systemdString(`${key}=${value}`)}`)
  .join("\n")}
Restart=always
RestartSec=5
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
`;
      if (resolve(serviceDirectory) !== systemdDirectory) {
        throw new Error(
          "Custom ADC_SERVICE_DIR supports macOS tests only; use --no-service on Linux."
        );
      }
      await stopService();
      await writeFile(serviceFile, content, { mode: 0o600 });
      await command("systemctl", ["--user", "daemon-reload"]);
      await command("systemctl", ["--user", "enable", unit]);
    } else {
      throw new Error(`Unsupported service platform: ${process.platform}`);
    }
  }
  await startService();
  if (process.platform === "linux") {
    let linger = false;
    try {
      const result = await command("loginctl", [
        "show-user",
        String(process.getuid!()),
        "--property=Linger",
        "--value"
      ]);
      linger = result.stdout.trim() === "yes";
    } catch {
      /* Status is unknown on systems without logind. */
    }
    if (!linger)
      console.log(
        "Background service starts at login. To keep it across logout, ask your administrator to enable loginctl enable-linger for your user."
      );
  }
  console.log("Background service started. Use adc-node status and adc-node logs to inspect it.");
}

export async function showLogs(): Promise<void> {
  if (process.platform === "linux") {
    const result = await command("journalctl", ["--user", "-u", unit, "-n", "100", "--no-pager"]);
    process.stdout.write(result.stdout);
    return;
  }
  const path = resolve(logDirectory, "node.log");
  if (!existsSync(path)) {
    console.log("No service logs yet.");
    return;
  }
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  process.stdout.write(`${lines.slice(-101).join("\n")}\n`);
}

export async function uninstall(): Promise<void> {
  const paths = installedPaths();
  const state = existsSync(configPath) ? resolve((await loadConfig()).stateDirectory) : undefined;
  if (pathContains(paths.install, configPath) || (state && pathContains(paths.install, state))) {
    throw new Error("Move device state outside ADC_INSTALL_DIR before uninstalling.");
  }
  await stopService();
  if (process.platform === "win32") {
    if (await windowsTaskRegistered())
      await command("schtasks.exe", ["/Delete", "/TN", taskName, "/F"]);
    await rm(serviceFile, { force: true });
    await rm(windowsRunner, { force: true });
  } else if (existsSync(serviceFile)) {
    if (process.platform === "linux") await command("systemctl", ["--user", "disable", unit]);
    await rm(serviceFile);
    if (process.platform === "linux") await command("systemctl", ["--user", "daemon-reload"]);
  }
  const launcherNames =
    process.platform === "win32" ? ["adc.cmd", "adc-node.cmd"] : ["adc", "adc-node"];
  const managedLaunchers: string[] = [];
  for (const name of launcherNames) {
    const launcher = resolve(paths.bin, name);
    if (
      existsSync(launcher) &&
      (await readFile(launcher, "utf8")).includes(
        process.platform === "win32" ? "REM ADC managed launcher" : "# ADC managed launcher"
      )
    ) {
      managedLaunchers.push(launcher);
      if (process.platform !== "win32") await rm(launcher);
    }
  }
  if (process.platform === "win32") {
    const removals = [...managedLaunchers, paths.install]
      .map(
        (path) =>
          `Remove-Item -LiteralPath ${powershellLiteral(path)} -Recurse -Force -ErrorAction SilentlyContinue`
      )
      .join("; ");
    const cleanup = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; ${removals}`
      ],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    cleanup.unref();
  } else {
    await rm(paths.install, { recursive: true });
  }
  console.log(
    `Uninstalled. Device identity and receipts remain at ${dirname(configPath)}.\nRevoke this device in the console if it will no longer be used.`
  );
}
