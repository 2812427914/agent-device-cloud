import { publicContent, type LocalizedText } from "./public-content.ts";
import type { Locale } from "./i18n.tsx";

export const SITE_NAME = "Agent Device Cloud";
export const PUBLIC_ORIGIN_PLACEHOLDER = "__ADC_PUBLIC_ORIGIN__";

export interface PublicRouteMetadata {
  path: string;
  title: LocalizedText;
  description: LocalizedText;
  kind: "website" | "article" | "documentation";
  keywords: string[];
  publishedAt?: string;
  updatedAt?: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
}

const text = (en: string, zh: string): LocalizedText => ({ en, "zh-CN": zh });

const docs: Array<[string, string, string]> = [
  ["", "Documentation", "Connect AI agents to governed tools on your own macOS and Linux devices."],
  ["quickstart", "Get started", "Connect an account, device and Agent authorization."],
  ["use-cases", "Use cases", "Practical ways to run AI agent work on an existing device."],
  [
    "concepts",
    "Core concepts",
    "Accounts, devices, grants, capabilities, dispatches and receipts."
  ],
  ["architecture", "Architecture", "Control-plane authorization with device-local execution."],
  ["security", "Security", "Identity, authorization, local enforcement and known limitations."],
  ["connector", "Device connector", "Install, pair and operate the outbound device Connector."],
  ["integrations", "Integrations", "Connect MCP clients, the CLI, SDK and official Skill."],
  ["tools", "Tool reference", "Built-in file, process, template and task tools."],
  [
    "api",
    "API and errors",
    "Authentication boundaries, invocation envelopes, task states and stable errors."
  ],
  ["self-hosting", "Self-hosting", "Deploy Agent Device Cloud with PostgreSQL and HTTPS."],
  [
    "operations",
    "Operations guide",
    "Monitor health, verify backups, perform upgrades and respond to incidents."
  ],
  [
    "troubleshooting",
    "Troubleshooting",
    "Diagnose connectivity, authorization and execution failures."
  ],
  ["roadmap", "Roadmap", "Current capabilities and explicitly planned work."],
  [
    "contributing",
    "Contributing",
    "Repository structure, development workflow and review requirements."
  ],
  ["changelog", "Changelog", "Versioned Agent Device Cloud product changes."]
];

const baseRoutes: PublicRouteMetadata[] = [
  {
    path: "/",
    title: text(
      "Agent Device Cloud | Secure device access for AI agents",
      "Agent Device Cloud | AI Agent 安全设备访问"
    ),
    description: text(
      "Give AI agents controlled access to files, tools and environments on your own macOS and Linux devices.",
      "让 AI Agent 在明确授权、审批和审计下访问你自己的 macOS 与 Linux 设备。"
    ),
    kind: "website",
    keywords: [
      "AI agent device access",
      "remote AI agent",
      "MCP device connector",
      "secure agent tools"
    ],
    changeFrequency: "weekly",
    priority: 1
  },
  {
    path: "/updates",
    title: text("Updates and articles | Agent Device Cloud", "动态与文章 | Agent Device Cloud"),
    description: text(
      "Product releases, engineering decisions and practical guides for secure AI agent device access.",
      "关于 AI Agent 安全设备访问的产品发布、工程决策与实用指南。"
    ),
    kind: "website",
    keywords: ["Agent Device Cloud updates", "AI agent engineering", "MCP security"],
    changeFrequency: "weekly",
    priority: 0.8
  }
];

const docsRoutes: PublicRouteMetadata[] = docs.map(([slug, title, description]) => ({
  path: slug ? `/docs/${slug}` : "/docs",
  title: text(`${title} | Agent Device Cloud`, `${title} | Agent Device Cloud`),
  description: text(description, description),
  kind: "documentation",
  keywords: ["Agent Device Cloud documentation", "AI agent device access", title],
  changeFrequency: "monthly",
  priority: slug ? 0.65 : 0.8
}));

const contentRoutes: PublicRouteMetadata[] = publicContent.map((entry) => ({
  path: entry.path,
  title: {
    en: `${entry.title.en} | Agent Device Cloud`,
    "zh-CN": `${entry.title["zh-CN"]} | Agent Device Cloud`
  },
  description: entry.summary,
  kind: entry.kind === "Policy" ? "website" : "article",
  keywords: entry.keywords,
  publishedAt: entry.publishedAt,
  updatedAt: entry.updatedAt,
  changeFrequency: entry.kind === "Policy" ? "monthly" : "yearly",
  priority: entry.kind === "Policy" ? 0.5 : 0.75
}));

export const publicRoutes = [...baseRoutes, ...docsRoutes, ...contentRoutes];

export function normalizePublicPath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

export function publicRouteMetadata(pathname: string): PublicRouteMetadata | undefined {
  const normalized = normalizePublicPath(pathname);
  return publicRoutes.find((route) => route.path === normalized);
}

export function localizedMetadata(
  metadata: PublicRouteMetadata,
  locale: Locale
): { title: string; description: string } {
  return {
    title: metadata.title[locale],
    description: metadata.description[locale]
  };
}

export function publicOrigin(): string {
  return typeof window === "undefined" ? PUBLIC_ORIGIN_PLACEHOLDER : window.location.origin;
}
