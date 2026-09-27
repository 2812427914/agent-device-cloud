import { describe, expect, it } from "vitest";
import { ToolNameSchema } from "../../../packages/protocol/src/index.ts";
import { catalogs, zh } from "./i18n.tsx";
import { documentedTools, docsPageId, docsPages } from "./docs.tsx";

describe("documentation navigation", () => {
  it("resolves every documented route and rejects unknown pages", () => {
    expect(docsPageId("/docs")).toBe("overview");
    expect(docsPageId("/docs/")).toBe("overview");
    for (const page of docsPages.slice(1)) {
      expect(docsPageId(`/docs/${page.id}`)).toBe(page.id);
    }
    expect(docsPageId("/docs/unknown")).toBeUndefined();
    expect(new Set(docsPages.map((page) => page.id)).size).toBe(docsPages.length);
    expect(docsPages.map((page) => page.id)).toEqual(
      expect.arrayContaining(["use-cases", "architecture", "security", "roadmap"])
    );
    expect(new Set(docsPages.map((page) => page.group))).toEqual(
      new Set(["Start", "Understand", "Build", "Operate", "Project"])
    );
  });

  it("documents every protocol tool exactly once", () => {
    expect(new Set(documentedTools).size).toBe(documentedTools.length);
    expect([...documentedTools].sort()).toEqual([...ToolNameSchema.options].sort());
  });

  it("keeps both locale catalogs complete with matching placeholders", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(catalogs.en[key]).toBeTruthy();
      expect(placeholders(catalogs.en[key]).sort()).toEqual(
        placeholders(catalogs["zh-CN"][key]).sort()
      );
    }
  });
});
