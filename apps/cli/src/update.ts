import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { z } from "zod";

const ArchiveSchema = z
  .object({
    file: z.string().regex(/^adc-[a-zA-Z0-9._-]+\.tar\.gz$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive()
  })
  .strict();
const ManifestSchema = z
  .object({
    version: z.string().min(1),
    runtimeVersion: z.string().min(1),
    buildId: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    archives: z.record(z.string(), ArchiveSchema)
  })
  .strict();
const ReleaseSchema = z
  .object({
    version: z.string().min(1),
    runtime: z.string().min(1),
    buildId: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional()
  })
  .strict();
const NodeSourceSchema = z.object({ controlPlaneUrl: z.string().url() }).passthrough();

export interface UpdateOptions {
  check: boolean;
  force: boolean;
  noService: boolean;
  downloadUrl?: string;
}

function updateURL(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Update URL must use HTTPS, or loopback HTTP, without credentials or query.");
  return url.href.replace(/\/$/, "");
}

function target(): string {
  const platform =
    process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "";
  const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "";
  if (!platform || !architecture)
    throw new Error(`Updates are unavailable for ${process.platform}-${process.arch}.`);
  return `${platform}-${architecture}`;
}

async function fetchText(url: string, label: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error(`${label} is unexpectedly large.`);
  return text;
}

async function nodeControlPlane(): Promise<string | undefined> {
  const path = process.env.ADC_NODE_CONFIG ?? resolve(homedir(), ".config", "adc", "node.json");
  try {
    return NodeSourceSchema.parse(JSON.parse(await readFile(path, "utf8"))).controlPlaneUrl;
  } catch {
    return;
  }
}

async function runInstaller(
  script: string,
  options: { controlPlaneUrl?: string; downloadUrl: string; noService: boolean }
): Promise<void> {
  const args = [
    "-s",
    "--",
    "--download-url",
    options.downloadUrl,
    ...(options.controlPlaneUrl ? ["--url", options.controlPlaneUrl] : []),
    ...(options.noService ? ["--no-service"] : [])
  ];
  const child = spawn("/bin/sh", args, {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let diagnostics = "";
  const relay = (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(-16_384);
    process.stderr.write(chunk);
  };
  child.stdout.on("data", relay);
  child.stderr.on("data", relay);
  child.stdin.end(script);
  const status = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  if (status !== 0) {
    const detail = diagnostics.trim().split("\n").at(-1);
    throw new Error(
      detail ? `Update failed: ${detail}` : `Update failed with exit code ${status}.`
    );
  }
}

export async function updateClient(options: UpdateOptions) {
  const installDirectory =
    process.env.ADC_INSTALL_DIR ?? resolve(homedir(), ".local", "share", "agent-device-cloud");
  const currentDirectory = await realpath(resolve(installDirectory, "current")).catch(() => {
    throw new Error("ADC is not installed through the managed installer.");
  });
  const current = ReleaseSchema.parse(
    JSON.parse(await readFile(resolve(currentDirectory, "release.json"), "utf8"))
  );
  const controlPlaneUrl = process.env.ADC_CONTROL_PLANE_URL ?? (await nodeControlPlane());
  const source =
    options.downloadUrl ??
    process.env.ADC_UPDATE_URL ??
    (controlPlaneUrl ? `${controlPlaneUrl.replace(/\/$/, "")}/downloads/node` : undefined);
  if (!source)
    throw new Error("Update source is unavailable. Pass --download-url or reinstall ADC once.");
  const downloadUrl = updateURL(source);
  const manifest = ManifestSchema.parse(
    JSON.parse(await fetchText(`${downloadUrl}/manifest.json`, "Update manifest"))
  );
  const platform = target();
  const archive = manifest.archives[platform];
  if (!archive) throw new Error(`The update does not contain ${platform}.`);
  const expectedRelease = archive.file.replace(/\.tar\.gz$/, "");
  const installedRelease = basename(currentDirectory);
  const updateAvailable =
    current.buildId && manifest.buildId
      ? current.buildId !== manifest.buildId
      : installedRelease !== expectedRelease;
  const status = {
    schemaVersion: "0.1",
    current: {
      version: current.version,
      runtimeVersion: current.runtime,
      buildId: current.buildId ?? null,
      release: installedRelease
    },
    available: {
      version: manifest.version,
      runtimeVersion: manifest.runtimeVersion,
      buildId: manifest.buildId ?? null,
      release: expectedRelease,
      bytes: archive.bytes
    },
    updateAvailable
  };
  if (options.check || (!updateAvailable && !options.force)) return status;

  const installer = await fetchText(`${downloadUrl}/install.sh`, "Installer");
  if (!installer.startsWith("#!/bin/sh") || !installer.includes("# ADC managed launcher"))
    throw new Error("Downloaded installer is not an ADC installer.");
  await runInstaller(installer, {
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
    downloadUrl,
    noService: options.noService
  });
  const installedDirectory = await realpath(resolve(installDirectory, "current"));
  const installed = ReleaseSchema.parse(
    JSON.parse(await readFile(resolve(installedDirectory, "release.json"), "utf8"))
  );
  if (
    manifest.buildId
      ? installed.buildId !== manifest.buildId
      : basename(installedDirectory) !== expectedRelease
  )
    throw new Error("The installer completed but the expected release is not active.");
  return {
    ...status,
    updated: true,
    updateAvailable: false,
    current: {
      version: installed.version,
      runtimeVersion: installed.runtime,
      buildId: installed.buildId ?? null,
      release: basename(installedDirectory)
    }
  };
}
