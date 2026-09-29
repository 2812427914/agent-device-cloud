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
    expect(clientRoute.body).not.toContain("adc-analytics");
  });

  it("serves prerendered public pages and keeps hosted analytics opt-in", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "adc-public-site-"));
    directories.push(directory);
    await mkdir(resolve(directory, "docs", "security"), { recursive: true });
    await writeFile(resolve(directory, "index.html"), "<main>home</main>");
    await writeFile(
      resolve(directory, ".adc-app-shell.html"),
      "<html><head></head><body><main>app shell</main></body></html>"
    );
    await writeFile(
      resolve(directory, "docs", "security", "index.html"),
      "<html><head></head><body><main>security at __ADC_PUBLIC_ORIGIN__</main></body></html>"
    );
    await writeFile(
      resolve(directory, ".adc-public-pages.json"),
      JSON.stringify({
        generatedAt: "2026-09-29T00:00:00.000Z",
        routes: [
          {
            path: "/docs/security",
            title: "Security",
            description: "Security model",
            kind: "documentation",
            changeFrequency: "monthly",
            priority: 0.7
          }
        ],
        feed: [
          {
            path: "/updates/example",
            title: "Example",
            description: "Example update",
            publishedAt: "2026-09-29",
            updatedAt: "2026-09-29"
          }
        ],
        llmsFull: "# Agent Device Cloud"
      })
    );
    const access = accessFixture({ cookie: "adc.session_token=public-site-test" });
    const app = await createControlPlane({
      store: new MemoryStore(),
      access,
      consoleDirectory: directory,
      analytics: {
        provider: "plausible",
        scriptUrl: "https://analytics.example/script.js",
        domain: "adc.example"
      }
    });
    apps.push(app);

    const page = await app.inject({ method: "GET", url: "/docs/security" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`security at ${access.origin}`);
    expect(page.body).toContain(
      '<meta name="adc-analytics" data-provider="plausible" data-domain="adc.example"'
    );
    expect(page.body).toContain('data-script-url="https://analytics.example/script.js"');
    expect(page.body).not.toContain('<script data-adc-analytics="plausible"');
    expect(page.headers["x-robots-tag"]).toBeUndefined();

    const appRoute = await app.inject({ method: "GET", url: "/app?sig=private-value" });
    expect(appRoute.body).toContain("<main>app shell</main>");
    expect(appRoute.body).toContain('meta name="adc-analytics"');
    expect(appRoute.body).not.toContain("private-value");
    expect(appRoute.headers["x-robots-tag"]).toBe("noindex, nofollow");

    const robots = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(robots.body).toContain(`Sitemap: ${access.origin}/sitemap.xml`);
    expect(robots.body).toContain("Disallow: /app");

    const sitemap = await app.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sitemap.body).toContain(`${access.origin}/docs/security`);

    const llms = await app.inject({ method: "GET", url: "/llms.txt" });
    expect(llms.body).toContain(`[Security](${access.origin}/docs/security)`);

    const feed = await app.inject({ method: "GET", url: "/feed.xml" });
    expect(feed.body).toContain(`${access.origin}/updates/example`);
  });
});
