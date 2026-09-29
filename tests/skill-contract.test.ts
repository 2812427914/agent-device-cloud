import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolNameSchema } from "../packages/protocol/src/index.ts";

const root = resolve(import.meta.dirname, "..");
const skillDirectory = resolve(root, "skills", "agent-device-cloud");

describe("official Agent Device Cloud Skill", () => {
  it("has loadable trigger metadata and all referenced files", async () => {
    const skill = await readFile(resolve(skillDirectory, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: agent-device-cloud\n/);
    expect(skill).toMatch(/^description: .+ Use (?:it )?when .+$/m);
    expect(skill).toContain("references/account-and-device-management.md");
    expect(skill).toContain("references/tool-invocation.md");

    await expect(
      readFile(resolve(skillDirectory, "references", "account-and-device-management.md"), "utf8")
    ).resolves.not.toHaveLength(0);
    await expect(
      readFile(resolve(skillDirectory, "references", "tool-invocation.md"), "utf8")
    ).resolves.not.toHaveLength(0);
  });

  it("keeps the documented built-in tool table aligned with the protocol", async () => {
    const reference = await readFile(
      resolve(skillDirectory, "references", "tool-invocation.md"),
      "utf8"
    );
    const documented = [...reference.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
    expect(documented).toEqual(ToolNameSchema.options);
  });

  it("requires discovery, invocation tracking and independent approval", async () => {
    const skill = await readFile(resolve(skillDirectory, "SKILL.md"), "utf8");
    expect(skill).toContain("adc node list --json");
    expect(skill).toContain("adc tool list --json");
    expect(skill).toContain("adc tool show <tool-id> --json");
    expect(skill).toContain("adc invocation status <invocationId> --json");
    expect(skill).toContain("Never run `adc approval approve`");
    expect(skill).toContain("unknown_outcome");
  });
});
