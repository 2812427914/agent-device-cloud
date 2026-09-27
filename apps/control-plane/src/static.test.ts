import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@adc/db";
import { createControlPlane } from "./app.ts";
import { accessFixture } from "../../../tests/helpers/access-fixture.ts";

const apps: Awaited<ReturnType<typeof createControlPlane>>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("console static files", () => {
  it("serves hashed assets created after startup without falling back to HTML", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "adc-console-"));
    directories.push(directory);
    await writeFile(resolve(directory, "index.html"), "<main>console</main>");
    const app = await createControlPlane({
      store: new MemoryStore(),
      access: accessFixture({ cookie: "adc.session_token=static-test" }),
      consoleDirectory: directory
    });
    apps.push(app);

    await mkdir(resolve(directory, "assets"));
    await writeFile(resolve(directory, "assets", "index-new.css"), "body { color: black; }");

    const asset = await app.inject({ method: "GET", url: "/assets/index-new.css" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/css");
    expect(asset.body).toBe("body { color: black; }");

    const missing = await app.inject({ method: "GET", url: "/assets/missing.css" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).not.toContain("text/html");

    const clientRoute = await app.inject({ method: "GET", url: "/docs/security" });
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toBe("<main>console</main>");
  });
});
