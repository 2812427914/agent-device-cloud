import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface HostedAnalyticsOptions {
  provider: "plausible";
  scriptUrl: string;
  domain: string;
}

interface PublicManifestRoute {
  path: string;
  title: string;
  description: string;
  kind: "website" | "article" | "documentation";
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  publishedAt?: string;
  updatedAt?: string;
}

interface PublicFeedItem {
  path: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
}

interface PublicManifest {
  generatedAt: string;
  routes: PublicManifestRoute[];
  feed: PublicFeedItem[];
  llmsFull: string;
}

const publicOriginPlaceholder = "__ADC_PUBLIC_ORIGIN__";

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function analyticsConfigurationTag(analytics: HostedAnalyticsOptions | undefined): string {
  if (!analytics) return "";
  return `<meta name="adc-analytics" data-provider="${analytics.provider}" data-domain="${escapeAttribute(
    analytics.domain
  )}" data-script-url="${escapeAttribute(analytics.scriptUrl)}" />`;
}

export class PublicSite {
  private constructor(
    private readonly directory: string,
    private readonly manifest: PublicManifest | undefined,
    private readonly templates: Map<string, string>,
    private readonly appShell: string
  ) {}

  static async load(directory: string): Promise<PublicSite> {
    const index = await readFile(resolve(directory, "index.html"), "utf8");
    let manifest: PublicManifest | undefined;
    try {
      manifest = JSON.parse(
        await readFile(resolve(directory, ".adc-public-pages.json"), "utf8")
      ) as PublicManifest;
    } catch {
      return new PublicSite(directory, undefined, new Map(), index);
    }

    const templates = new Map<string, string>();
    await Promise.all(
      manifest.routes.map(async (route) => {
        const filename =
          route.path === "/" ? "index.html" : `${route.path.replace(/^\//, "")}/index.html`;
        templates.set(route.path, await readFile(resolve(directory, filename), "utf8"));
      })
    );
    const appShell = await readFile(resolve(directory, ".adc-app-shell.html"), "utf8").catch(
      () => index
    );
    return new PublicSite(directory, manifest, templates, appShell);
  }

  get root(): string {
    return this.directory;
  }

  isPublic(pathname: string): boolean {
    return this.templates.has(normalizePath(pathname));
  }

  renderHtml(
    pathname: string,
    origin: string,
    analytics?: HostedAnalyticsOptions
  ): { html: string; isPublic: boolean } {
    const normalized = normalizePath(pathname);
    const template = this.templates.get(normalized) ?? this.appShell;
    const isPublic = this.templates.has(normalized);
    const tracking = analyticsConfigurationTag(analytics);
    const html = template
      .replaceAll(publicOriginPlaceholder, origin)
      .replace("</head>", tracking ? `    ${tracking}\n  </head>` : "</head>");
    return { html, isPublic };
  }

  robots(origin: string): string {
    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /app",
      "Disallow: /authorize",
      "Disallow: /cli-login",
      "Disallow: /login",
      "Disallow: /register",
      "Disallow: /forgot-password",
      "Disallow: /reset-password",
      "Disallow: /mcp",
      `Sitemap: ${origin}/sitemap.xml`,
      ""
    ].join("\n");
  }

  sitemap(origin: string): string {
    const routes = this.manifest?.routes ?? [];
    const urls = routes
      .map((route) => {
        const lastModified = route.updatedAt ?? route.publishedAt ?? this.manifest?.generatedAt;
        return [
          "  <url>",
          `    <loc>${escapeXml(`${origin}${route.path}`)}</loc>`,
          ...(lastModified
            ? [`    <lastmod>${escapeXml(lastModified.slice(0, 10))}</lastmod>`]
            : []),
          `    <changefreq>${route.changeFrequency}</changefreq>`,
          `    <priority>${route.priority.toFixed(1)}</priority>`,
          "  </url>"
        ].join("\n");
      })
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }

  llms(origin: string): string {
    const routes = this.manifest?.routes ?? [];
    const section = (heading: string, items: PublicManifestRoute[]) =>
      [
        `## ${heading}`,
        "",
        ...items.map((route) => `- [${route.title}](${origin}${route.path}): ${route.description}`),
        ""
      ].join("\n");
    return [
      "# Agent Device Cloud",
      "",
      "> Secure device access for AI agents. The control plane authorizes and routes work; the selected device validates and executes it locally.",
      "",
      "Use the documentation as the source of truth for current product behavior and security boundaries.",
      "",
      section(
        "Documentation",
        routes.filter((route) => route.kind === "documentation")
      ),
      section(
        "Articles and updates",
        routes.filter((route) => route.kind === "article")
      )
    ].join("\n");
  }

  llmsFull(origin: string): string {
    return (this.manifest?.llmsFull ?? this.llms(origin)).replaceAll(
      publicOriginPlaceholder,
      origin
    );
  }

  feed(origin: string): string {
    const items = (this.manifest?.feed ?? [])
      .map((item) =>
        [
          "    <item>",
          `      <title>${escapeXml(item.title)}</title>`,
          `      <link>${escapeXml(`${origin}${item.path}`)}</link>`,
          `      <guid isPermaLink="true">${escapeXml(`${origin}${item.path}`)}</guid>`,
          `      <description>${escapeXml(item.description)}</description>`,
          `      <pubDate>${new Date(`${item.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>`,
          "    </item>"
        ].join("\n")
      )
      .join("\n");
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0">',
      "  <channel>",
      "    <title>Agent Device Cloud updates</title>",
      `    <link>${escapeXml(`${origin}/updates`)}</link>`,
      "    <description>Product releases, engineering decisions and practical guides.</description>",
      ...items.split("\n"),
      "  </channel>",
      "</rss>",
      ""
    ].join("\n");
  }
}
