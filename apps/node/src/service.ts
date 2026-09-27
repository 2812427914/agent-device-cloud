import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { configPath, loadConfig } from "./config.ts";

const exec = promisify(execFile);
const installDirectory = process.env.ADC_INSTALL_DIR;
const binDirectory = process.env.ADC_BIN_DIR;
const suffix = createHash("sha256").update(configPath).digest("hex").slice(0, 12);
const label = `com.agentdevicecloud.node.${suffix}`;
const unit = `adc-node-${suffix}.service`;
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
    : systemdDirectory);
const serviceFile = resolve(
  serviceDirectory,
  process.platform === "darwin" ? `${label}.plist` : unit
);
const domain = `gui/${process.getuid!()}`;

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

async function command(binary: string, args: string[]) {
  try {
    return await exec(binary, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
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

export async function serviceStatus() {
  const registered = existsSync(serviceFile);
  let running = false;
  let detail = "";
  if (registered) {
    try {
      const result =
        process.platform === "darwin"
          ? await command("launchctl", ["print", `${domain}/${label}`])
          : await command("systemctl", ["--user", "show", unit, "--property=ActiveState,SubState"]);
      detail = result.stdout;
      running =
        process.platform === "darwin"
          ? /\bstate = running\b/.test(detail)
          : detail.includes("ActiveState=active") && detail.includes("SubState=running");
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
  if (!existsSync(serviceFile)) return;
  if (process.platform === "darwin") {
    // A stopped job is absent from the launchd domain.
    if (!(await launchdLoaded())) return;
    await command("launchctl", ["bootout", `${domain}/${label}`]);
  } else {
    await command("systemctl", ["--user", "stop", unit]);
  }
}

export async function startService(): Promise<void> {
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
      // A stale launchd entry can disappear between print and kickstart during
      // an in-place upgrade. Bootstrap the newly written plist in that case.
      if (!/Could not find service/i.test((error as Error).message)) throw error;
      await command("launchctl", ["bootstrap", domain, serviceFile]);
    }
  } else {
    await command("systemctl", ["--user", "start", unit]);
  }
}

export async function installService(): Promise<void> {
  const paths = installedPaths();
  await loadConfig();
  await mkdir(serviceDirectory, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  // Capture the user's development tool PATH: services don't source shell profiles.
  const environment: Record<string, string> = {
    PATH: `${paths.bin}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
    ADC_NODE_CONFIG: configPath,
    ADC_INSTALL_DIR: paths.install,
    ADC_BIN_DIR: paths.bin,
    ADC_SERVICE_DIR: serviceDirectory
  };
  const launcher = resolve(paths.bin, "adc-node");
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
    // systemctl resolves unit files only from its configured search directories.
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
  const result = await command("tail", ["-n", "100", path]);
  process.stdout.write(result.stdout);
}

export async function uninstall(): Promise<void> {
  const paths = installedPaths();
  const state = existsSync(configPath) ? resolve((await loadConfig()).stateDirectory) : undefined;
  if (
    configPath.startsWith(`${paths.install}/`) ||
    state === paths.install ||
    state?.startsWith(`${paths.install}/`)
  ) {
    throw new Error("Move device state outside ADC_INSTALL_DIR before uninstalling.");
  }
  await stopService();
  if (existsSync(serviceFile)) {
    if (process.platform === "linux") await command("systemctl", ["--user", "disable", unit]);
    await rm(serviceFile);
    if (process.platform === "linux") await command("systemctl", ["--user", "daemon-reload"]);
  }
  for (const name of ["adc", "adc-node"]) {
    const launcher = resolve(paths.bin, name);
    if (
      existsSync(launcher) &&
      (await readFile(launcher, "utf8")).includes("# ADC managed launcher")
    ) {
      await rm(launcher);
    }
  }
  await rm(paths.install, { recursive: true });
  console.log(
    `Uninstalled. Device identity and receipts remain at ${dirname(configPath)}.\nRevoke this device in the console if it will no longer be used.`
  );
}
