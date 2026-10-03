import { createHash, randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sha256Pattern = /^sha256:([a-f0-9]{64})$/;

export interface AssetStore {
  put(sha256: string, data: Buffer): Promise<void>;
  get(sha256: string): Promise<Buffer>;
}

export class LocalContentAddressedAssetStore implements AssetStore {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  async put(sha256: string, data: Buffer): Promise<void> {
    const digest = digestOf(sha256);
    verifyDigest(data, sha256);
    const shard = join(this.root, digest.slice(0, 2));
    await ensureDirectory(this.root);
    await ensureDirectory(shard);
    const target = join(shard, digest);
    const temporary = join(shard, `.${digest}.${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    const handle = await open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
      const directoryHandle = await open(shard, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyContent(target, sha256);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(sha256: string): Promise<Buffer> {
    const digest = digestOf(sha256);
    const data = await readFile(join(this.root, digest.slice(0, 2), digest));
    verifyDigest(data, sha256);
    return data;
  }
}

function digestOf(sha256: string): string {
  const match = sha256Pattern.exec(sha256);
  if (!match) throw new Error("invalid asset SHA-256");
  return match[1]!;
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`asset path is not a physical directory: ${path}`);
  }
}

async function verifyContent(path: string, expected: string): Promise<void> {
  verifyDigest(await readFile(path), expected);
}

function verifyDigest(data: Buffer, expected: string): void {
  const actual = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  if (actual !== expected) throw new Error("asset content hash mismatch");
}
