import { createHash } from "node:crypto";
import { ProtocolError, type Invocation } from "@adc/protocol";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}

export function invocationInputHash(invocation: Invocation): string {
  return createHash("sha256")
    .update(
      canonical({
        accountId: invocation.accountId,
        actor: invocation.actor,
        authorization: invocation.authorization,
        tool: invocation.tool,
        args: invocation.args,
        target: invocation.target,
        idempotencyKey: invocation.idempotencyKey
      })
    )
    .digest("hex");
}

export function assertSameInvocation(existing: Invocation, incoming: Invocation): void {
  if (invocationInputHash(existing) !== invocationInputHash(incoming)) {
    throw new ProtocolError(
      "conflict",
      "Invocation or idempotency key has already been used.",
      false
    );
  }
}
