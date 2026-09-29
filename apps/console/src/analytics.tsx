import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "./i18n.tsx";
import {
  localizedMetadata,
  normalizePublicPath,
  publicRouteMetadata,
  SITE_NAME
} from "./site-metadata.ts";

type AnalyticsProperty = string | number | boolean;
type PlausibleOptions = {
  props?: Record<string, AnalyticsProperty>;
  url?: string;
  autoCapturePageviews?: boolean;
};

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }

  interface Window {
    plausible?: {
      (event: string, options?: PlausibleOptions): void;
      q?: unknown[][];
    };
  }
}

const eventNames = {
  account_registered: "Account Registered",
  account_signed_in: "Account Signed In",
  github_sign_in_started: "GitHub Sign In Started",
  pairing_code_created: "Pairing Code Created",
  agent_access_created: "Agent Access Created",
  connection_created: "Connection Created",
  primary_cta_selected: "Primary CTA Selected",
  setup_completed: "Initial Setup Completed"
} as const;

export type AnalyticsEventName = keyof typeof eventNames;

const productRoutes = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/authorize",
  "/cli-login",
  "/app",
  "/app/devices",
  "/app/projects",
  "/app/agents",
  "/app/approvals",
  "/app/activity",
  "/app/settings"
]);

const campaignParameters = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
  "source"
] as const;

function privacyPreferenceEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
}

function queuePlausible(): NonNullable<Window["plausible"]> {
  window.plausible ??= Object.assign(
    (name: string, options?: PlausibleOptions) => {
      window.plausible!.q ??= [];
      window.plausible!.q!.push([name, options]);
    },
    { q: [] as unknown[][] }
  );
  return window.plausible;
}

function analyticsEnabled(): boolean {
  if (typeof document === "undefined" || privacyPreferenceEnabled()) return false;
  const configuration = document.head.querySelector<HTMLMetaElement>(
    'meta[name="adc-analytics"][data-provider="plausible"]'
  );
  if (!configuration) return false;

  if (!document.querySelector('script[data-adc-analytics="plausible"]')) {
    const scriptUrl = configuration.dataset.scriptUrl;
    const domain = configuration.dataset.domain;
    if (!scriptUrl || !domain) return false;

    const plausible = queuePlausible();
    plausible("init", { autoCapturePageviews: false });
    const script = document.createElement("script");
    script.async = true;
    script.dataset.adcAnalytics = "plausible";
    script.dataset.domain = domain;
    script.src = scriptUrl;
    document.head.append(script);
  }
  return true;
}

function cleanProperties(
  properties: Record<string, AnalyticsProperty> = {}
): Record<string, AnalyticsProperty> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => /^[a-z][a-z0-9_]{0,31}$/.test(key))
      .slice(0, 8)
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 96) : value])
  );
}

export function trackAnalytics(
  event: AnalyticsEventName,
  properties: Record<string, AnalyticsProperty> = {}
): boolean {
  if (!analyticsEnabled()) return false;
  try {
    queuePlausible()(eventNames[event], { props: cleanProperties(properties) });
    return true;
  } catch {
    // Analytics must never affect product behavior.
    return false;
  }
}

function campaignProperties(search: string): Record<string, AnalyticsProperty> {
  const query = new URLSearchParams(search);
  return Object.fromEntries(
    campaignParameters.flatMap((name) => {
      const value = query.get(name);
      return value ? [[name, value.slice(0, 96)]] : [];
    })
  );
}

export function analyticsEventForRequest(
  path: string,
  method = "GET"
): AnalyticsEventName | undefined {
  if (method.toUpperCase() !== "POST") return undefined;
  const pathname = path.split("?")[0];
  if (pathname === "/api/auth/sign-up/email") return "account_registered";
  if (pathname === "/api/auth/sign-in/email") return "account_signed_in";
  if (pathname === "/api/auth/sign-in/social") return "github_sign_in_started";
  if (pathname === "/api/v1/pairing-codes") return "pairing_code_created";
  if (pathname === "/api/v1/grants") return "agent_access_created";
  if (pathname === "/api/v1/credentials" || pathname === "/api/v1/oauth/bindings")
    return "connection_created";
  return undefined;
}

export function analyticsPath(pathname: string): string | undefined {
  const normalized = normalizePublicPath(pathname);
  if (publicRouteMetadata(normalized) || productRoutes.has(normalized)) return normalized;
  return undefined;
}

function upsertMeta(selector: string, attributes: Record<string, string>): HTMLMetaElement {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.append(element);
  }
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function upsertCanonical(href: string | undefined): void {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }
  element.href = href;
}

export function AnalyticsEffects() {
  const location = useLocation();
  const { locale } = useI18n();
  const lastTrackedPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    const pathname = normalizePublicPath(location.pathname);
    const metadata = publicRouteMetadata(pathname);
    if (metadata) {
      const localized = localizedMetadata(metadata, locale);
      const canonical = `${window.location.origin}${metadata.path}`;
      document.title = localized.title;
      upsertMeta('meta[name="description"]', {
        name: "description",
        content: localized.description
      });
      upsertMeta('meta[name="robots"]', {
        name: "robots",
        content: "index,follow,max-image-preview:large"
      });
      upsertMeta('meta[property="og:title"]', {
        property: "og:title",
        content: localized.title
      });
      upsertMeta('meta[property="og:description"]', {
        property: "og:description",
        content: localized.description
      });
      upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical });
      upsertCanonical(canonical);
    } else {
      document.title = `${SITE_NAME} · Console`;
      upsertMeta('meta[name="robots"]', { name: "robots", content: "noindex,nofollow" });
      upsertCanonical(undefined);
    }
  }, [locale, location.pathname]);

  useEffect(() => {
    const pathname = analyticsPath(location.pathname);
    if (!pathname || lastTrackedPath.current === pathname || !analyticsEnabled()) return;
    lastTrackedPath.current = pathname;
    try {
      queuePlausible()("pageview", {
        url: `${window.location.origin}${pathname}`,
        props: publicRouteMetadata(pathname)
          ? cleanProperties(campaignProperties(location.search))
          : {}
      });
    } catch {
      // Route transitions remain independent from analytics.
    }
  }, [location.pathname, location.search]);

  return null;
}
