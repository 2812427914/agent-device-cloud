import { describe, expect, it } from "vitest";
import { analyticsEventForRequest, analyticsPath, trackAnalytics } from "./analytics.tsx";
import { publicContent } from "./public-content.ts";
import { publicRouteMetadata, publicRoutes } from "./site-metadata.ts";

describe("public site metadata", () => {
  it("defines one indexable entry for every public route", () => {
    const paths = publicRoutes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/docs/security");
    expect(paths).toContain("/updates");
    for (const entry of publicContent) {
      expect(publicRouteMetadata(entry.path)).toMatchObject({ path: entry.path });
    }
    expect(publicRouteMetadata("/privacy")?.kind).toBe("website");
    expect(publicRouteMetadata("/articles/ai-agent-behind-nat")?.kind).toBe("article");
    expect(publicRouteMetadata("/app")).toBeUndefined();
    expect(publicRouteMetadata("/login")).toBeUndefined();
    expect(analyticsPath("/articles/ai-agent-behind-nat/")).toBe("/articles/ai-agent-behind-nat");
    expect(analyticsPath("/app/devices")).toBe("/app/devices");
    expect(analyticsPath("/app/devices/private-id")).toBeUndefined();
    expect(analyticsPath("/unknown/private-value")).toBeUndefined();
  });

  it("maps only coarse successful product actions to analytics events", () => {
    expect(analyticsEventForRequest("/api/auth/sign-up/email", "POST")).toBe("account_registered");
    expect(analyticsEventForRequest("/api/v1/pairing-codes", "POST")).toBe("pairing_code_created");
    expect(analyticsEventForRequest("/api/v1/grants", "POST")).toBe("agent_access_created");
    expect(analyticsEventForRequest("/api/v1/grants/grant_example", "PATCH")).toBeUndefined();
    expect(analyticsEventForRequest("/api/v1/invocations", "POST")).toBeUndefined();
    expect(() => trackAnalytics("primary_cta_selected", { placement: "test" })).not.toThrow();
  });
});
