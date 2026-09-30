import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { windowsTaskDefinition } from "./service.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("macOS service startup", () => {
  it.runIf(process.platform === "darwin")(
    "bootstraps when a stale launchd entry disappears before kickstart",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "adc-service-"));
      temporaryDirectories.push(directory);
      const configPath = resolve(directory, "node.json");
      const serviceDirectory = resolve(directory, "LaunchAgents");
      const binDirectory = resolve(directory, "bin");
      const installDirectory = resolve(directory, "install");
      const commandLog = resolve(directory, "launchctl.log");
      await mkdir(serviceDirectory);
      await mkdir(binDirectory);
      await mkdir(installDirectory);
      await writeFile(resolve(installDirectory, ".adc-installation"), "Agent Device Cloud\n");

      const suffix = createHash("sha256").update(configPath).digest("hex").slice(0, 12);
      const label = `com.agentdevicecloud.node.${suffix}`;
      await writeFile(resolve(serviceDirectory, `${label}.plist`), "<plist/>");
      const launchctl = resolve(binDirectory, "launchctl");
      await writeFile(
        launchctl,
        `#!/bin/sh
printf '%s\\n' "$*" >> "$ADC_TEST_LAUNCHCTL_LOG"
case "$1" in
  print) exit 0 ;;
  kickstart) printf 'Could not find service "%s"\\n' "$2" >&2; exit 3 ;;
  bootstrap) exit 0 ;;
esac
exit 2
`
      );
      await chmod(launchctl, 0o755);

      const moduleUrl = pathToFileURL(resolve(import.meta.dirname, "service.ts")).href;
      await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `const { startService } = await import(${JSON.stringify(moduleUrl)}); await startService();`
        ],
        {
          env: {
            ...process.env,
            ADC_NODE_CONFIG: configPath,
            ADC_SERVICE_DIR: serviceDirectory,
            ADC_INSTALL_DIR: installDirectory,
            ADC_BIN_DIR: binDirectory,
            ADC_TEST_LAUNCHCTL_LOG: commandLog,
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`
          }
        }
      );

      const calls = (await readFile(commandLog, "utf8")).trim().split("\n");
      expect(calls).toEqual([
        `print gui/${process.getuid!()}/${label}`,
        `kickstart gui/${process.getuid!()}/${label}`,
        `bootstrap gui/${process.getuid!()} ${resolve(serviceDirectory, `${label}.plist`)}`
      ]);
    }
  );
});

describe("Windows task startup", () => {
  it("defines a least-privilege logon task with restart behavior", () => {
    const xml = windowsTaskDefinition("C:\\Users\\owner\\ADC & Tools\\node.cmd", "S-1-5-21-1234");
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("ADC &amp; Tools");
    expect(xml).toContain("<UserId>S-1-5-21-1234</UserId>");
  });
});
