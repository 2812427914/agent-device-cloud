import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import { applyPatch } from "diff";
import {
  ErrorCodes,
  InvocationSchema,
  ProtocolError,
  ReceiptSchema,
  ResultSchema,
  absolutePathForToolArgs,
  assertInvocationCurrent,
  createId,
  isBuiltinTool,
  isSideEffectTool,
  relativePathFromRoot,
  rootForAbsolutePath,
  type Invocation,
  type InvocationResult,
  type PolicyDecision,
  type Receipt
} from "@adc/protocol";
import { sha256 } from "@adc/policy";
import {
  readResourceFile,
  redactSecrets,
  resolveResourcePath,
  syncDirectory,
  type LocalRoot
} from "./path-security.ts";
import { ReceiptLedger } from "./receipt-ledger.ts";

export interface CommandTemplate {
  projectId?: string | undefined;
  templateId: string;
  rootId: string;
  command: string;
  timeoutMs: number;
  readOnly: boolean;
}

export interface ToolRuntimeOptions {
  nodeId: string;
  roots: LocalRoot[];
  templates?: CommandTemplate[];
  stateDirectory: string;
  outputLimitBytes?: number;
  allowNetwork?: boolean;
  fullTrust?: boolean;
  now?: () => Date;
  externalExecutor?: ExternalToolExecutor;
}

interface Execution {
  output: Record<string, unknown>;
  artifactRefs: string[];
  succeeded: boolean;
}

export type ExternalToolExecutor = (
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<Execution>;

const dangerousCommandPatterns: Array<[RegExp, string]> = [
  [/(^|[\s;&|])sudo(?:\s|$)/, "shell.sudo"],
  [/(^|[\s;&|])(?:curl|wget|nc|ncat|ssh|scp|sftp)(?:\s|$)/, "shell.network"],
  [
    /(^|[\s;&|])rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+\/(?:\s|$)/,
    "shell.root_delete"
  ],
  [/(^|[\s;&|])(?:launchctl|systemctl|shutdown|reboot)(?:\s|$)/, "shell.system_control"],
  [/(^|[\s/])\.\.(?:\/|\s|$)/, "shell.parent_traversal"],
  [/(^|[\s"'=])\/(?!dev\/null(?:\s|$))[^\s;&|]*/, "shell.absolute_path"],
  [/(^|[\s;&|])(?:env|printenv|set)(?:\s|$)/, "shell.environment_dump"]
];

function assertSafeGlob(pattern: string): void {
  if (pattern.startsWith("/") || pattern.includes("\\") || pattern.split("/").includes("..")) {
    throw new ProtocolError(ErrorCodes.DENIED, "glob escapes the selected root", false, {
      reasonCode: "path.glob_escape"
    });
  }
}

function assertSafeCommand(command: string, allowNetwork: boolean): void {
  for (const [pattern, reasonCode] of dangerousCommandPatterns) {
    if (reasonCode === "shell.network" && allowNetwork) {
      continue;
    }
    if (pattern.test(command)) {
      throw new ProtocolError(ErrorCodes.DENIED, "command rejected by the local policy", false, {
        reasonCode
      });
    }
  }
}

function statusForError(error: ProtocolError): InvocationResult["status"] {
  if (error.code === ErrorCodes.DENIED) return "denied";
  if (error.code === ErrorCodes.CANCELLED) return "cancelled";
  if (error.code === ErrorCodes.UNKNOWN_OUTCOME) return "unknown_outcome";
  return "failed";
}

export class ToolRuntime {
  private readonly roots: Map<string, LocalRoot>;
  private readonly templates: Map<string, CommandTemplate>;
  private readonly ledger: ReceiptLedger;
  private readonly outputLimitBytes: number;
  private readonly allowNetwork: boolean;
  private fullTrust: boolean;
  private readonly now: () => Date;
  private readonly artifactDirectory: string;
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly options: ToolRuntimeOptions) {
    this.roots = new Map();
    this.templates = new Map();
    this.fullTrust = options.fullTrust ?? false;
    this.updateAccess(options.roots, options.templates ?? [], this.fullTrust);
    this.ledger = new ReceiptLedger(resolve(options.stateDirectory, "receipts"));
    this.artifactDirectory = resolve(options.stateDirectory, "artifacts");
    this.outputLimitBytes = options.outputLimitBytes ?? 64 * 1024;
    this.allowNetwork = options.allowNetwork ?? false;
    this.now = options.now ?? (() => new Date());
  }

  updateAccess(roots: LocalRoot[], templates: CommandTemplate[], fullTrust = false): void {
    this.fullTrust = fullTrust;
    this.roots.clear();
    for (const root of roots)
      this.roots.set(root.rootId, { ...root, allowSensitivePaths: fullTrust });
    this.templates.clear();
    for (const template of templates)
      this.templates.set(
        `${template.projectId ?? ""}:${template.rootId}:${template.templateId}`,
        template
      );
  }

  async execute(
    rawInvocation: Invocation,
    policyDecision: PolicyDecision,
    signal?: AbortSignal
  ): Promise<InvocationResult> {
    const invocation = InvocationSchema.parse(rawInvocation);
    const startedAt = this.now();
    const sideEffect = isSideEffectTool(invocation.tool);
    const argsHash = sha256(invocation.args);
    let ledgerKeyHash: string | undefined;

    if (policyDecision.outcome !== "allow") {
      const error = new ProtocolError(
        policyDecision.outcome === "approval_required"
          ? ErrorCodes.APPROVAL_REQUIRED
          : ErrorCodes.DENIED,
        policyDecision.explanation,
        false,
        { reasonCode: policyDecision.reasonCode }
      );
      return ResultSchema.parse({
        schemaVersion: "0.1",
        invocationId: invocation.invocationId,
        attemptId: invocation.attemptId,
        status: policyDecision.outcome === "approval_required" ? "approval_required" : "denied",
        error: error.toJSON()
      });
    }

    if (sideEffect) {
      let ledgerState;
      try {
        ledgerState = await this.ledger.begin({
          scope: `${invocation.accountId}:${invocation.actor.id}`,
          idempotencyKey: invocation.idempotencyKey!,
          input: { tool: invocation.tool, args: invocation.args, target: invocation.target },
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          now: startedAt
        });
      } catch (error) {
        const protocolError =
          error instanceof ProtocolError
            ? error
            : new ProtocolError(ErrorCodes.INTERNAL, "receipt ledger is unavailable", true);
        const completedAt = this.now();
        const receipt = this.makeReceipt({
          invocation,
          policyDecision,
          status:
            protocolError.code === ErrorCodes.DENIED
              ? "denied"
              : protocolError.code === ErrorCodes.UNKNOWN_OUTCOME
                ? "unknown_outcome"
                : "failed",
          startedAt,
          completedAt,
          argsHash,
          artifactRefs: []
        });
        return ResultSchema.parse({
          schemaVersion: "0.1",
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          status: statusForError(protocolError),
          error: protocolError.toJSON(),
          receipt
        });
      }
      if (ledgerState.state === "replay") {
        return ResultSchema.parse({
          ...ledgerState.result,
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          receipt: {
            ...ledgerState.receipt,
            invocationId: invocation.invocationId,
            attemptId: invocation.attemptId,
            replayed: true
          }
        });
      }
      if (ledgerState.state === "unknown") {
        const receipt = this.makeReceipt({
          invocation,
          policyDecision,
          status: "unknown_outcome",
          startedAt: new Date(ledgerState.entry.startedAt),
          completedAt: this.now(),
          argsHash,
          artifactRefs: []
        });
        return ResultSchema.parse({
          schemaVersion: "0.1",
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          status: "unknown_outcome",
          error: new ProtocolError(
            ErrorCodes.UNKNOWN_OUTCOME,
            "a prior attempt started but has no durable terminal receipt",
            false,
            { originalInvocationId: ledgerState.entry.invocationId }
          ).toJSON(),
          receipt
        });
      }
      ledgerKeyHash = ledgerState.keyHash;
    }

    let execution: Execution | undefined;
    let executionError: ProtocolError | undefined;
    try {
      // A completed receipt can be reconciled after expiry. New work must still
      // produce a terminal expired result, without executing a tool.
      assertInvocationCurrent(invocation, this.now());
      execution = await this.executeTool(invocation, signal);
      if (!execution.succeeded) {
        executionError = new ProtocolError(
          ErrorCodes.EXECUTION_FAILED,
          "tool process returned a non-zero exit status",
          false
        );
      }
    } catch (error) {
      executionError = signal?.aborted
        ? new ProtocolError(ErrorCodes.CANCELLED, "invocation was cancelled", false)
        : error instanceof ProtocolError
          ? error
          : new ProtocolError(
              ErrorCodes.EXECUTION_FAILED,
              "local tool failed; check device logs and resource availability",
              false
            );
    }

    const completedAt = this.now();
    const status = executionError ? statusForError(executionError) : "succeeded";
    const receipt = this.makeReceipt({
      invocation,
      policyDecision,
      status:
        status === "succeeded"
          ? "succeeded"
          : status === "denied"
            ? "denied"
            : status === "cancelled"
              ? "cancelled"
              : status === "unknown_outcome"
                ? "unknown_outcome"
                : "failed",
      startedAt,
      completedAt,
      argsHash,
      output: execution?.output,
      artifactRefs: execution?.artifactRefs ?? []
    });
    const result = ResultSchema.parse({
      schemaVersion: "0.1",
      invocationId: invocation.invocationId,
      attemptId: invocation.attemptId,
      status,
      ...(execution ? { output: execution.output } : {}),
      ...(executionError ? { error: executionError.toJSON() } : {}),
      receipt
    });

    if (ledgerKeyHash) {
      try {
        await this.ledger.complete(ledgerKeyHash, result, receipt, completedAt);
      } catch {
        return ResultSchema.parse({
          schemaVersion: "0.1",
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          status: "unknown_outcome",
          error: new ProtocolError(
            ErrorCodes.UNKNOWN_OUTCOME,
            "execution ended but the terminal receipt could not be persisted",
            false
          ).toJSON(),
          receipt: { ...receipt, terminalStatus: "unknown_outcome" }
        });
      }
    }
    return result;
  }

  private root(rootId: string): LocalRoot {
    const root = this.roots.get(rootId);
    if (!root) {
      throw new ProtocolError(ErrorCodes.DENIED, "root is not configured on this device", false, {
        reasonCode: "node.root_unavailable"
      });
    }
    return root;
  }

  private localArgs(invocation: Invocation): Record<string, any> {
    const args = { ...(invocation.args as Record<string, unknown>) } as Record<string, any>;
    const absolutePath = absolutePathForToolArgs(invocation.tool, args);
    if (!absolutePath) return args;
    const root = rootForAbsolutePath(absolutePath, [...this.roots.values()]);
    if (!root) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "absolute path is outside the folders configured on this device",
        false,
        { reasonCode: "node.root_unavailable", path: absolutePath }
      );
    }
    args.rootId = root.rootId;
    if (invocation.tool.startsWith("file.")) {
      args.path = relativePathFromRoot(root.path, absolutePath);
    } else {
      args.cwd = relativePathFromRoot(root.path, absolutePath);
    }
    return args;
  }

  private async executeTool(invocation: Invocation, signal?: AbortSignal): Promise<Execution> {
    if (signal?.aborted) {
      throw new ProtocolError(ErrorCodes.CANCELLED, "invocation was cancelled", false);
    }
    const args = this.localArgs(invocation);
    const builtin = isBuiltinTool(invocation.tool);
    if (
      (builtin && args.rootId && !invocation.authorization.rootIds.includes(args.rootId)) ||
      (builtin && args.projectId && args.projectId !== invocation.authorization.projectId) ||
      ("nodeId" in invocation.target && invocation.target.nodeId !== this.options.nodeId)
    ) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "invocation does not authorize this resource",
        false
      );
    }
    switch (invocation.tool) {
      case "file.list":
        return this.listFiles(args);
      case "file.read":
        return this.readFile(args);
      case "file.search":
        return this.searchFiles(args);
      case "file.write":
        return this.mutate(args, () => this.writeFile(args), signal);
      case "file.edit":
        return this.mutate(args, () => this.editFile(args), signal);
      case "file.patch":
        return this.mutate(args, () => this.patchFile(args), signal);
      case "shell.exec":
        return this.runShell(args.rootId, args.cwd, args.command, args.timeoutMs, args.env, signal);
      case "command.template.list":
        return this.listTemplates(args.projectId, invocation.authorization.rootIds);
      case "command.template.run":
        if (Object.keys(args.parameters).length) {
          throw new ProtocolError(
            ErrorCodes.INVALID_REQUEST,
            "this template does not accept parameters",
            false
          );
        }
        return this.runTemplate(
          args.projectId,
          args.rootId,
          args.templateId,
          args.cwd ?? "",
          undefined,
          signal
        );
      case "test.run":
        return this.runTemplate(
          args.projectId,
          args.rootId,
          args.templateId,
          args.cwd ?? "",
          args.timeoutMs,
          signal
        );
      default:
        if (!isBuiltinTool(invocation.tool) && this.options.externalExecutor) {
          return this.options.externalExecutor(invocation.tool, args, signal);
        }
        throw new ProtocolError(
          ErrorCodes.INVALID_REQUEST,
          `tool is handled by the control plane, not the local runtime: ${invocation.tool}`,
          false
        );
    }
  }

  private async listFiles(args: Record<string, any>): Promise<Execution> {
    const root = this.root(args.rootId);
    const directory = await resolveResourcePath(root, args.path, "read");
    const pattern = args.glob ?? "**/*";
    assertSafeGlob(pattern);
    const entries = await fg(pattern, {
      cwd: directory,
      dot: this.fullTrust,
      followSymbolicLinks: false,
      onlyFiles: false,
      markDirectories: true,
      unique: true
    });
    const safeEntries: string[] = [];
    for (const entry of entries.sort()) {
      if (safeEntries.length >= args.maxEntries) break;
      const resourcePath = [args.path, entry.replace(/\/$/, "")].filter(Boolean).join("/");
      try {
        await resolveResourcePath(root, resourcePath, "read");
        safeEntries.push(entry);
      } catch {
        // Symlinks and protected paths are intentionally invisible to callers.
      }
    }
    return {
      output: { entries: safeEntries, truncated: entries.length > safeEntries.length },
      artifactRefs: [],
      succeeded: true
    };
  }

  private async readFile(args: Record<string, any>): Promise<Execution> {
    const content = this.redactOutput(
      await readResourceFile(this.root(args.rootId), args.path, args.maxBytes)
    );
    return {
      output: { content, bytes: Buffer.byteLength(content) },
      artifactRefs: [],
      succeeded: true
    };
  }

  private async searchFiles(args: Record<string, any>): Promise<Execution> {
    const root = this.root(args.rootId);
    const directory = await resolveResourcePath(root, args.path, "read");
    const pattern = args.glob ?? "**/*";
    assertSafeGlob(pattern);
    const files = await fg(pattern, {
      cwd: directory,
      dot: this.fullTrust,
      onlyFiles: true,
      followSymbolicLinks: false,
      unique: true
    });
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const file of files.sort()) {
      if (matches.length >= args.maxMatches) break;
      const resourcePath = [args.path, file].filter(Boolean).join("/");
      let content: string;
      try {
        content = await readResourceFile(root, resourcePath, 2 * 1024 * 1024);
      } catch {
        continue;
      }
      if (content.includes("\0")) continue;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(args.query)) {
          matches.push({ path: file, line: index + 1, text: this.redactOutput(line) });
          if (matches.length >= args.maxMatches) break;
        }
      }
    }
    return {
      output: { matches, truncated: matches.length >= args.maxMatches },
      artifactRefs: [],
      succeeded: true
    };
  }

  private async mutate(
    args: Record<string, any>,
    operation: () => Promise<Execution>,
    signal?: AbortSignal
  ): Promise<Execution> {
    const key = `${args.rootId}:${args.path}`;
    const previous = this.mutations.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => {
        if (signal?.aborted)
          throw new ProtocolError(ErrorCodes.CANCELLED, "invocation was cancelled", false);
        return operation();
      });
    this.mutations.set(key, current);
    try {
      return await current;
    } finally {
      if (this.mutations.get(key) === current) this.mutations.delete(key);
    }
  }

  private async replaceResource(
    args: Record<string, any>,
    content: string,
    expected?: string
  ): Promise<void> {
    const root = this.root(args.rootId);
    const target = await resolveResourcePath(root, args.path, "write");
    const parent = await lstat(dirname(target));
    const temporary = resolve(
      dirname(target),
      `.${basename(target)}.${randomBytes(16).toString("hex")}.tmp`
    );
    try {
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      const checked = await resolveResourcePath(root, args.path, "write");
      const currentParent = await lstat(dirname(checked));
      if (
        checked !== target ||
        parent.ino !== currentParent.ino ||
        parent.dev !== currentParent.dev
      ) {
        throw new ProtocolError(ErrorCodes.CONFLICT, "resource parent changed during write", true);
      }
      if (
        expected !== undefined &&
        expected !== (await readResourceFile(root, args.path, 10 * 1024 * 1024))
      ) {
        throw new ProtocolError(ErrorCodes.CONFLICT, "resource changed during edit", true);
      }
      if (args.createOnly) {
        // Atomic no-replace publication, including when another writer creates
        // the target after validation. Never overwrite in createOnly mode.
        await link(temporary, target);
      } else {
        await rename(temporary, target);
      }
      await syncDirectory(dirname(target));
    } catch (error: any) {
      if (error?.code === "EEXIST")
        throw new ProtocolError(ErrorCodes.CONFLICT, "resource already exists", false);
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private async writeFile(args: Record<string, any>): Promise<Execution> {
    await this.replaceResource(args, args.content);
    return {
      output: { bytesWritten: Buffer.byteLength(args.content), created: args.createOnly },
      artifactRefs: [],
      succeeded: true
    };
  }

  private async editFile(args: Record<string, any>): Promise<Execution> {
    await resolveResourcePath(this.root(args.rootId), args.path, "write");
    const current = await readResourceFile(this.root(args.rootId), args.path, 10 * 1024 * 1024);
    const occurrences = current.split(args.oldText).length - 1;
    if (occurrences === 0) {
      throw new ProtocolError(ErrorCodes.CONFLICT, "oldText was not found", false);
    }
    if (!args.replaceAll && occurrences !== 1) {
      throw new ProtocolError(
        ErrorCodes.CONFLICT,
        "oldText is not unique; set replaceAll explicitly",
        false,
        { occurrences }
      );
    }
    const updated = args.replaceAll
      ? current.split(args.oldText).join(args.newText)
      : current.replace(args.oldText, args.newText);
    await this.replaceResource(args, updated, current);
    return {
      output: {
        replacements: args.replaceAll ? occurrences : 1,
        bytesWritten: Buffer.byteLength(updated)
      },
      artifactRefs: [],
      succeeded: true
    };
  }

  private async patchFile(args: Record<string, any>): Promise<Execution> {
    await resolveResourcePath(this.root(args.rootId), args.path, "write");
    const current = await readResourceFile(this.root(args.rootId), args.path, 10 * 1024 * 1024);
    const updated = applyPatch(current, args.patch);
    if (updated === false) {
      throw new ProtocolError(ErrorCodes.CONFLICT, "patch does not apply cleanly", false);
    }
    await this.replaceResource(args, updated, current);
    return {
      output: { patched: true, bytesWritten: Buffer.byteLength(updated) },
      artifactRefs: [],
      succeeded: true
    };
  }

  private listTemplates(projectId: string | undefined, rootIds: string[]): Execution {
    const templates = [...this.templates.values()]
      .filter((template) => template.projectId === projectId && rootIds.includes(template.rootId))
      .map(({ templateId, rootId, timeoutMs, readOnly }) => ({
        templateId,
        rootId,
        cwd: this.root(rootId).path,
        timeoutMs,
        readOnly
      }));
    return { output: { templates }, artifactRefs: [], succeeded: true };
  }

  private async runTemplate(
    projectId: string | undefined,
    rootId: string,
    templateId: string,
    cwdPath: string,
    timeoutOverride?: number,
    signal?: AbortSignal
  ): Promise<Execution> {
    const template = this.templates.get(`${projectId ?? ""}:${rootId}:${templateId}`);
    if (!template) {
      if (
        [...this.templates.values()].some(
          (candidate) => candidate.projectId === projectId && candidate.templateId === templateId
        )
      ) {
        throw new ProtocolError(
          ErrorCodes.DENIED,
          "template root does not match the authorized root",
          false
        );
      }
      throw new ProtocolError(ErrorCodes.NOT_FOUND, "command template was not found", false);
    }
    return this.runShell(
      template.rootId,
      cwdPath,
      template.command,
      Math.min(timeoutOverride ?? template.timeoutMs, template.timeoutMs),
      {},
      signal
    );
  }

  private async storeArtifact(content: string): Promise<string> {
    await mkdir(this.artifactDirectory, { recursive: true, mode: 0o700 });
    // Receipt replay preserves this ID. Equal output from independent accounts
    // or invocations must not alias the same control-plane artifact record.
    const id = `artifact_${randomBytes(16).toString("hex")}.log`;
    const handle = await open(resolve(this.artifactDirectory, id), "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(this.artifactDirectory);
    return id;
  }

  async readArtifact(artifactId: string): Promise<Buffer> {
    if (!/^artifact_[a-f0-9]{32}\.log$/.test(artifactId)) {
      throw new ProtocolError(ErrorCodes.INVALID_REQUEST, "invalid artifact reference", false);
    }
    const target = resolve(this.artifactDirectory, artifactId);
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > 25 * 1024 * 1024) {
      throw new ProtocolError(
        ErrorCodes.INVALID_REQUEST,
        "artifact is not a regular file or exceeds the upload limit",
        false
      );
    }
    return readFile(target);
  }

  private async runShell(
    rootId: string,
    cwdPath: string,
    command: string,
    timeoutMs: number,
    invocationEnv: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Execution> {
    if (!this.fullTrust) assertSafeCommand(command, this.allowNetwork);
    const root = this.root(rootId);
    if (!root.writable) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "process execution requires a writable root",
        false
      );
    }
    const reserved =
      /^(?:PATH|HOME|TMPDIR|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|CDPATH|IFS|ZDOTDIR|NODE_OPTIONS|PYTHONPATH|PYTHONHOME|PERL5OPT|RUBYOPT|LD_.*|DYLD_.*)$/;
    if (!this.fullTrust && Object.keys(invocationEnv).some((name) => reserved.test(name))) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "invocation environment overrides a reserved variable",
        false
      );
    }
    const cwd = await resolveResourcePath(root, cwdPath, "read");
    const tempRoot = resolve(this.options.stateDirectory, "tmp");
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const tempDirectory = await mkdtemp(resolve(tempRoot, "exec-"));

    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", command], {
      cwd,
      detached: true,
      env: this.fullTrust
        ? {
            ...process.env,
            HOME: process.env.HOME ?? homedir(),
            ...invocationEnv
          }
        : {
            PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            HOME: cwd,
            TMPDIR: tempDirectory,
            LANG: process.env.LANG ?? "C.UTF-8",
            CI: "1",
            ...invocationEnv
          },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const artifactLimitBytes = 25 * 1024 * 1024 - 1024;
    let capturedBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (!child.pid || killTimer) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      killTimer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, 1000).unref();
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      const remaining = artifactLimitBytes - capturedBytes;
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining);
        target.push(captured);
        capturedBytes += captured.byteLength;
      }
      if (chunk.byteLength > remaining) {
        outputLimitExceeded = true;
        terminate();
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    const onAbort = () => {
      cancelled = true;
      terminate();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();

    const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolvePromise, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolvePromise({ code, signal }));
      }
    ).finally(async () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      await rm(tempDirectory, { recursive: true, force: true });
    });

    if (cancelled) {
      throw new ProtocolError(ErrorCodes.CANCELLED, "invocation was cancelled", false);
    }

    const fullStdout = this.redactOutput(Buffer.concat(stdout).toString("utf8"));
    const fullStderr = this.redactOutput(Buffer.concat(stderr).toString("utf8"));
    const combinedBytes = Buffer.byteLength(fullStdout) + Buffer.byteLength(fullStderr);
    const artifactRefs: string[] = [];
    if (combinedBytes > this.outputLimitBytes) {
      artifactRefs.push(await this.storeArtifact(`STDOUT\n${fullStdout}\nSTDERR\n${fullStderr}`));
    }
    const stdoutOutput = Buffer.from(fullStdout)
      .subarray(0, this.outputLimitBytes)
      .toString("utf8");
    const remaining = Math.max(0, this.outputLimitBytes - Buffer.byteLength(stdoutOutput));
    const stderrOutput = Buffer.from(fullStderr).subarray(0, remaining).toString("utf8");

    return {
      output: {
        exitCode: completion.code,
        signal: completion.signal,
        timedOut,
        outputLimitExceeded,
        stdout: stdoutOutput,
        stderr: stderrOutput,
        truncated: combinedBytes > this.outputLimitBytes
      },
      artifactRefs,
      succeeded: !timedOut && !outputLimitExceeded && completion.code === 0
    };
  }

  private redactOutput(value: string): string {
    let redacted = this.fullTrust ? value : redactSecrets(value);
    redacted = redacted.split(this.options.stateDirectory).join("[node-state]");
    return redacted;
  }

  private makeReceipt(input: {
    invocation: Invocation;
    policyDecision: PolicyDecision;
    status: Receipt["terminalStatus"];
    startedAt: Date;
    completedAt: Date;
    argsHash: `sha256:${string}`;
    output?: unknown;
    artifactRefs: string[];
  }): Receipt {
    return ReceiptSchema.parse({
      schemaVersion: "0.1",
      receiptId: createId("rcpt"),
      invocationId: input.invocation.invocationId,
      attemptId: input.invocation.attemptId,
      nodeId: this.options.nodeId,
      tool: input.invocation.tool,
      terminalStatus: input.status,
      sideEffect: isSideEffectTool(input.invocation.tool),
      replayed: false,
      ...(input.invocation.idempotencyKey
        ? { idempotencyKeyHash: sha256(input.invocation.idempotencyKey) }
        : {}),
      argsHash: input.argsHash,
      policyDecisionHash: input.policyDecision.decisionHash,
      ...(input.output !== undefined ? { outputHash: sha256(input.output) } : {}),
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      durationMs: Math.max(0, input.completedAt.getTime() - input.startedAt.getTime()),
      artifactRefs: input.artifactRefs
    });
  }
}
