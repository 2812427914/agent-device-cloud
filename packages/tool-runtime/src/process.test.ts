import { describe, expect, it } from "vitest";
import { shellInvocation } from "./process.ts";

describe("shell process adapters", () => {
  it("uses an isolated Bash process group on Unix", () => {
    expect(shellInvocation("printf ok", "linux")).toEqual({
      executable: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", "printf ok"],
      detached: true
    });
  });

  it("encodes Windows PowerShell commands as UTF-16LE and preserves exit status", () => {
    const invocation = shellInvocation("Write-Output 'hello'", "win32");
    expect(invocation.executable).toBe("powershell.exe");
    expect(invocation.detached).toBe(false);
    const encoded = invocation.args.at(-1)!;
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(invocation.args).toContain("-NonInteractive");
    expect(script).toContain("[Console]::OutputEncoding");
    expect(script).toContain("Write-Output 'hello'");
    expect(script).toContain("exit $adcExitCode");
  });
});
