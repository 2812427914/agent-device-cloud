import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { Documentation } from "../src/docs.tsx";
import { LocaleProvider } from "../src/i18n.tsx";
import { Landing } from "../src/landing.tsx";
import { publicContent } from "../src/public-content.ts";
import { PublicContentRoute } from "../src/public-site.tsx";
import {
  PUBLIC_ORIGIN_PLACEHOLDER,
  publicRoutes,
  SITE_NAME,
  type PublicRouteMetadata
} from "../src/site-metadata.ts";

const outputDirectory = resolve(import.meta.dirname, "../dist");
const template = await readFile(resolve(outputDirectory, "index.html"), "utf8");
await writeFile(resolve(outputDirectory, ".adc-app-shell.html"), template);

function routeComponent(path: string) {
  if (path === "/") return <Landing signedIn={false} />;
  if (path === "/docs" || path.startsWith("/docs/")) return <Documentation signedIn={false} />;
  return <PublicContentRoute signedIn={false} />;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function jsonLd(metadata: PublicRouteMetadata) {
  const url = `${PUBLIC_ORIGIN_PLACEHOLDER}${metadata.path}`;
  if (metadata.path === "/") {
    return [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux",
        url,
        description: metadata.description.en,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url
      }
    ];
  }
  if (metadata.kind === "article") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: metadata.title.en.replace(` | ${SITE_NAME}`, ""),
      description: metadata.description.en,
      url,
      mainEntityOfPage: url,
      datePublished: metadata.publishedAt,
      dateModified: metadata.updatedAt ?? metadata.publishedAt,
      author: { "@type": "Organization", name: SITE_NAME },
      publisher: { "@type": "Organization", name: SITE_NAME }
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": metadata.kind === "documentation" ? "TechArticle" : "WebPage",
    headline: metadata.title.en.replace(` | ${SITE_NAME}`, ""),
    description: metadata.description.en,
    url,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: PUBLIC_ORIGIN_PLACEHOLDER
    }
  };
}

function head(metadata: PublicRouteMetadata): string {
  const canonical = `${PUBLIC_ORIGIN_PLACEHOLDER}${metadata.path}`;
  const schema = JSON.stringify(jsonLd(metadata)).replaceAll("<", "\\u003c");
  return [
    `<title>${escapeHtml(metadata.title.en)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description.en)}" />`,
    `<meta name="keywords" content="${escapeHtml(metadata.keywords.join(", "))}" />`,
    '<meta name="robots" content="index,follow,max-image-preview:large" />',
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:title" content="${escapeHtml(metadata.title.en)}" />`,
    `<meta property="og:description" content="${escapeHtml(metadata.description.en)}" />`,
    `<meta property="og:type" content="${metadata.kind === "article" ? "article" : "website"}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<script type="application/ld+json">${schema}</script>`
  ].join("\n    ");
}

function renderPage(metadata: PublicRouteMetadata): string {
  const body = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <StaticRouter location={metadata.path}>{routeComponent(metadata.path)}</StaticRouter>
    </LocaleProvider>
  );
  return template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(
      /<meta\s+(?:name|property)="(?:description|keywords|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g,
      ""
    )
    .replace("</head>", `    ${head(metadata)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${body}</div>`);
}

for (const metadata of publicRoutes) {
  const target =
    metadata.path === "/"
      ? resolve(outputDirectory, "index.html")
      : resolve(outputDirectory, metadata.path.slice(1), "index.html");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderPage(metadata));
}

const contentText = publicContent
  .map((entry) => {
    const sections = entry.sections
      .map((section) =>
        [
          `## ${section.title.en}`,
          ...section.paragraphs.map((paragraph) => paragraph.en),
          ...(section.bullets?.map((bullet) => `- ${bullet.en}`) ?? []),
          ...(section.code ? [`\`\`\`\n${section.code}\n\`\`\``] : [])
        ].join("\n\n")
      )
      .join("\n\n");
    return `# ${entry.title.en}\n\n${entry.summary.en}\n\n${sections}`;
  })
  .join("\n\n---\n\n");

await writeFile(
  resolve(outputDirectory, ".adc-public-pages.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      routes: publicRoutes.map((route) => ({
        path: route.path,
        title: route.title.en,
        description: route.description.en,
        kind: route.kind,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
        ...(route.publishedAt ? { publishedAt: route.publishedAt } : {}),
        ...(route.updatedAt ? { updatedAt: route.updatedAt } : {})
      })),
      feed: publicContent
        .filter((entry) => entry.listed)
        .map((entry) => ({
          path: entry.path,
          title: entry.title.en,
          description: entry.summary.en,
          publishedAt: entry.publishedAt,
          updatedAt: entry.updatedAt
        })),
      llmsFull: `# ${SITE_NAME}\n\nSecure device access for AI agents.\n\n${contentText}`
    },
    null,
    2
  )}\n`
);

console.log(`Prerendered ${publicRoutes.length} public routes.`);
