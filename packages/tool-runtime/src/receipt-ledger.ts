import { randomBytes } from "node:crypto";
import { open, mkdir, readFile, rename, link, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ErrorCodes,
  ProtocolError,
  ResultSchema,
  ReceiptSchema,
  type InvocationResult,
  type Receipt
} from "@adc/protocol";
import { sha256 } from "@adc/policy";
import { syncDirectory } from "./path-security.ts";

interface StartedEntry {
  state: "started";
  keyHash: string;
  inputHash: string;
  invocationId: string;
  attemptId: string;
  startedAt: string;
}

interface CompletedEntry extends Omit<StartedEntry, "state"> {
  state: "completed";
  completedAt: string;
  result: InvocationResult;
  receipt: Receipt;
}

type LedgerEntry = StartedEntry | CompletedEntry;

const StartedSchema = z
  .object({
    state: z.literal("started"),
    keyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    invocationId: z.string(),
    attemptId: z.string(),
    startedAt: z.iso.datetime()
  })
  .strict();
const EntrySchema = z.union([
  StartedSchema,
  StartedSchema.extend({
    state: z.literal("completed"),
    completedAt: z.iso.datetime(),
    result: ResultSchema,
    receipt: ReceiptSchema
  }).strict()
]);

export type LedgerBegin =
  | { state: "new"; keyHash: string; startedAt: string }
  | { state: "replay"; result: InvocationResult; receipt: Receipt }
  | { state: "unknown"; entry: StartedEntry };

export class ReceiptLedger {
  constructor(private readonly directory: string) {}

  private pathFor(keyHash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(keyHash)) throw new Error("invalid ledger key");
    return resolve(this.directory, `${keyHash.slice("sha256:".length)}.json`);
  }

  private async readEntry(keyHash: string): Promise<LedgerEntry> {
    try {
      const entry = EntrySchema.parse(JSON.parse(await readFile(this.pathFor(keyHash), "utf8")));
      if (entry.keyHash !== keyHash) throw new Error("ledger key mismatch");
      if (
        entry.state === "completed" &&
        (entry.result.invocationId !== entry.invocationId ||
          entry.result.attemptId !== entry.attemptId ||
          entry.receipt.invocationId !== entry.invocationId ||
          entry.receipt.attemptId !== entry.attemptId ||
          entry.result.status !== entry.receipt.terminalStatus)
      ) {
        throw new Error("ledger result mismatch");
      }
      return entry;
    } catch {
      throw new ProtocolError(
        ErrorCodes.UNKNOWN_OUTCOME,
        "durable receipt cannot be verified; execution will not be repeated",
        false
      );
    }
  }

  async begin(input: {
    scope: string;
    idempotencyKey: string;
    input: unknown;
    invocationId: string;
    attemptId: string;
    now: Date;
  }): Promise<LedgerBegin> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const keyHash = sha256(`${input.scope}:${input.idempotencyKey}`);
    const inputHash = sha256(input.input);
    const entry: StartedEntry = {
      state: "started",
      keyHash,
      inputHash,
      invocationId: input.invocationId,
      attemptId: input.attemptId,
      startedAt: input.now.toISOString()
    };
    const path = this.pathFor(keyHash);

    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Publish only a fully written, fsynced entry, without replacing another
      // process's claim. A crash before publication has not started execution.
      await link(temporary, path);
      await syncDirectory(this.directory);
      return { state: "new", keyHash, startedAt: entry.startedAt };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }

    const existing = await this.readEntry(keyHash);
    if (existing.inputHash !== inputHash) {
      throw new ProtocolError(
        ErrorCodes.CONFLICT,
        "idempotency key was already used with different input",
        false
      );
    }
    if (existing.state === "completed") {
      return { state: "replay", result: existing.result, receipt: existing.receipt };
    }
    return { state: "unknown", entry: existing };
  }

  async complete(
    keyHash: string,
    result: InvocationResult,
    receipt: Receipt,
    now: Date
  ): Promise<void> {
    const path = this.pathFor(keyHash);
    const current = await this.readEntry(keyHash);
    if (current.state === "completed") {
      return;
    }
    const completed: CompletedEntry = {
      ...current,
      state: "completed",
      completedAt: now.toISOString(),
      result,
      receipt
    };
    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(completed)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(this.directory);
  }
}
