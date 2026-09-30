import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { unzipSync, zipSync, type Zippable } from "fflate";

const root = resolve(import.meta.dirname, "..");
let output = resolve(root, "dist/node");
const cache = resolve(root, ".adc/runtime-cache");
const runtime = JSON.parse(await readFile(resolve(root, "deploy/node-runtime.json"), "utf8")) as {
  version: string;
  source: string;
  archives: Record<string, { file: string; sha256: string }>;
};
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
  version: string;
};
const args = process.argv.slice(2).filter((value) => value !== "--");
let downloadURL = process.env.ADC_NODE_DOWNLOAD_URL ?? "";
let targets = Object.keys(runtime.archives);
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--download-url") downloadURL = args[++index] ?? "";
  else if (args[index] === "--targets") targets = (args[++index] ?? "").split(",");
  else if (args[index] === "--out-dir") output = resolve(args[++index] ?? "dist/node");
  else throw new Error(`Unknown option: ${args[index]}`);
}
if (downloadURL) {
  const url = new URL(downloadURL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error(
      "--download-url must be HTTPS or loopback HTTP, with no credentials/query/hash."
    );
  }
  downloadURL = url.href.replace(/\/$/, "");
}
if (targets.length === 0 || targets.some((target) => !runtime.archives[target]))
  throw new Error("Unsupported --targets.");
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
const staging = await mkdtemp(resolve(root, ".adc/node-build-"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const powershellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const archiveTimestamp = new Date("2000-01-01T00:00:00.000Z");

async function zipEntries(directory: string, parts: string[] = []): Promise<Zippable> {
  const entries: Zippable = {};
  for (const name of await readdir(resolve(directory, ...parts))) {
    const next = [...parts, name];
    const path = resolve(directory, ...next);
    if ((await stat(path)).isDirectory()) {
      Object.assign(entries, await zipEntries(directory, next));
    } else {
      entries[next.join("/")] = [new Uint8Array(await readFile(path)), { mtime: archiveTimestamp }];
    }
  }
  return entries;
}

try {
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: { adc: "apps/cli/src/main.ts", "adc-node": "apps/node/src/main.ts" },
    outdir: resolve(staging, "lib"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    metafile: true,
    legalComments: "eof",
    define: { "process.env.ADC_BUILD_VERSION": JSON.stringify(version) },
    banner: {
      js: 'import { createRequire as __adcCreateRequire } from "node:module"; const require = __adcCreateRequire(import.meta.url);'
    }
  });
  const licenseDirectory = resolve(staging, "licenses");
  await mkdir(licenseDirectory);
  const packages = new Set<string>();
  for (const input of Object.keys(bundled.metafile.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let directory = dirname(resolve(root, input));
    while (directory !== root && dirname(directory) !== directory) {
      try {
        const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")) as {
          name?: string;
          version?: string;
          license?: string;
        };
        if (pkg.name && pkg.version) {
          packages.add(directory);
          break;
        }
      } catch {
        /* Continue through dist/esm to the owning package. */
      }
      directory = dirname(directory);
    }
  }
  const notices: string[] = [];
  for (const directory of packages) {
    const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string;
    };
    const name = `${pkg.name.replaceAll("/", "_")}@${pkg.version}`;
    const files = (await readdir(directory)).filter((file) =>
      /^(license|copying|notice)(\.|$)/i.test(file)
    );
    if (files.length === 0) throw new Error(`Missing license text for bundled dependency ${name}`);
    await mkdir(resolve(licenseDirectory, name), { recursive: true });
    for (const file of files)
      await cp(resolve(directory, file), resolve(licenseDirectory, name, file));
    notices.push(`${pkg.name} ${pkg.version}: ${pkg.license ?? "see included license"}`);
  }
  await writeFile(
    resolve(staging, "THIRD-PARTY-NOTICES.txt"),
    `Bundled Node.js ${runtime.version}: see licenses/Node-LICENSE\n\n${notices.sort().join("\n")}\n`
  );
  const buildHash = createHash("sha256").update(JSON.stringify(runtime));
  for (const name of ["adc.mjs", "adc-node.mjs"]) {
    buildHash.update(name);
    buildHash.update(await readFile(resolve(staging, "lib", name)));
  }
  buildHash.update(await readFile(resolve(root, "deploy/install.sh")));
  buildHash.update(await readFile(resolve(root, "deploy/install.ps1")));
  const buildId = `sha256:${buildHash.digest("hex")}`;
  await writeFile(
    resolve(staging, "release.json"),
    `${JSON.stringify({ version, runtime: runtime.version, buildId }, null, 2)}\n`
  );
  const archives: Record<string, { file: string; sha256: string; bytes: number }> = {};
  for (const target of targets) {
    const source = runtime.archives[target]!;
    const cached = resolve(cache, source.file);
    let verified = false;
    try {
      verified = digest(await readFile(cached)) === source.sha256;
    } catch {
      /* Download below. */
    }
    if (!verified) {
      console.log(`Downloading official Node.js ${runtime.version} (${target})`);
      const response = await fetch(`${runtime.source}/${source.file}`, {
        signal: AbortSignal.timeout(600_000)
      });
      if (!response.ok || !response.body)
        throw new Error(`Runtime download failed: ${response.status}`);
      const temporary = `${cached}.tmp`;
      await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      if (digest(await readFile(temporary)) !== source.sha256)
        throw new Error(`Runtime checksum failed: ${target}`);
      await rename(temporary, cached);
    }
    const payload = resolve(staging, target);
    await mkdir(resolve(payload, "runtime", "bin"), { recursive: true });
    const prefix = source.file.replace(/\.(?:tar\.gz|zip)$/, "");
    if (source.file.endsWith(".zip")) {
      const extracted = unzipSync(new Uint8Array(await readFile(cached)));
      const node = extracted[`${prefix}/node.exe`];
      const license = extracted[`${prefix}/LICENSE`];
      if (!node || !license) throw new Error(`Runtime archive is incomplete: ${target}`);
      await writeFile(resolve(payload, "runtime/bin/node.exe"), node);
      await writeFile(resolve(payload, "runtime/LICENSE"), license);
    } else {
      execFileSync("tar", [
        "-xzf",
        cached,
        "-C",
        resolve(payload, "runtime"),
        "--strip-components=1",
        `${prefix}/bin/node`,
        `${prefix}/LICENSE`
      ]);
    }
    await cp(resolve(staging, "lib"), resolve(payload, "lib"), { recursive: true });
    await cp(licenseDirectory, resolve(payload, "licenses"), { recursive: true });
    await cp(resolve(payload, "runtime/LICENSE"), resolve(payload, "licenses/Node-LICENSE"));
    await cp(
      resolve(staging, "THIRD-PARTY-NOTICES.txt"),
      resolve(payload, "THIRD-PARTY-NOTICES.txt")
    );
    await cp(resolve(staging, "release.json"), resolve(payload, "release.json"));
    const extension = target.startsWith("win32-") ? "zip" : "tar.gz";
    const temporary = resolve(staging, `${target}.${extension}`);
    if (extension === "zip") {
      await writeFile(temporary, zipSync(await zipEntries(payload), { level: 9 }));
    } else {
      execFileSync("tar", ["-czf", temporary, "-C", payload, "."], {
        env: { ...process.env, COPYFILE_DISABLE: "1" }
      });
    }
    const sha256 = digest(await readFile(temporary));
    const file = `adc-${version}-${target}-${sha256.slice(0, 16)}.${extension}`;
    archives[target] = { file, sha256, bytes: (await stat(temporary)).size };
    await rename(temporary, resolve(output, file));
    console.log(`Built ${file}`);
  }
  const template = await readFile(resolve(root, "deploy/install.sh"), "utf8");
  const installer = template.replace("@ADC_DOWNLOAD_URL@", quote(downloadURL)).replace(
    "@ADC_ARCHIVES@",
    Object.entries(archives)
      .map(
        ([target, archive]) =>
          `  ${target}) archive=${quote(archive.file)}; checksum=${quote(archive.sha256)} ;;`
      )
      .join("\n")
  );
  const windowsTemplate = await readFile(resolve(root, "deploy/install.ps1"), "utf8");
  const windowsInstaller = windowsTemplate
    .replace("@ADC_DOWNLOAD_URL@", powershellQuote(downloadURL))
    .replace(
      "@ADC_ARCHIVES@",
      Object.entries(archives)
        .map(
          ([target, archive]) =>
            `  ${powershellQuote(target)} = @{ File = ${powershellQuote(archive.file)}; Sha256 = ${powershellQuote(archive.sha256)} }`
        )
        .join("\n")
    );
  // Publish the installer last; keep prior content-addressed archives usable for cached scripts.
  await writeFile(
    resolve(output, "manifest.json"),
    `${JSON.stringify({ version, runtimeVersion: runtime.version, buildId, archives }, null, 2)}\n`
  );
  await writeFile(
    resolve(output, "SHA256SUMS"),
    `${Object.values(archives)
      .map((archive) => `${archive.sha256}  ${archive.file}`)
      .join("\n")}\n`
  );
  const nextInstaller = resolve(output, ".install.sh.next");
  await writeFile(nextInstaller, installer, { mode: 0o755 });
  await rename(nextInstaller, resolve(output, "install.sh"));
  const nextWindowsInstaller = resolve(output, ".install.ps1.next");
  await writeFile(nextWindowsInstaller, windowsInstaller);
  await rename(nextWindowsInstaller, resolve(output, "install.ps1"));
  console.log(`Ready to publish: ${output}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
