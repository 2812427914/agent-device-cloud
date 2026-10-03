import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalContentAddressedAssetStore } from "./asset-store.ts";

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "adc-assets-"));
  directories.push(directory);
  return {
    directory,
    store: new LocalContentAddressedAssetStore(directory)
  };
}

function digest(data: Buffer): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("LocalContentAddressedAssetStore", () => {
  it("stores and reads immutable content by SHA-256", async () => {
    const { store } = await fixture();
    const data = Buffer.from("screen pixels");
    const sha256 = digest(data);

    await store.put(sha256, data);
    await store.put(sha256, data);

    await expect(store.get(sha256)).resolves.toEqual(data);
  });

  it("rejects corrupted content at an existing digest path", async () => {
    const { directory, store } = await fixture();
    const expected = Buffer.from("expected");
    const sha256 = digest(expected);
    const value = sha256.slice("sha256:".length);
    const shard = join(directory, value.slice(0, 2));
    await mkdir(shard, { recursive: true });
    await writeFile(join(shard, value), "corrupted", {
      flag: "wx",
      mode: 0o600
    });

    await expect(store.put(sha256, expected)).rejects.toThrow("asset content hash mismatch");
  });
});
