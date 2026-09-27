import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CapabilitySchema,
  ErrorSchema,
  InvocationSchema,
  PolicyDecisionSchema,
  ReceiptSchema,
  ResultSchema
} from "./index.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(packageRoot, "schema");
const schemas = {
  invocation: InvocationSchema,
  result: ResultSchema,
  error: ErrorSchema,
  receipt: ReceiptSchema,
  capability: CapabilitySchema,
  "policy-decision": PolicyDecisionSchema
};

let drift = false;
await mkdir(outputDirectory, { recursive: true });

for (const [name, schema] of Object.entries(schemas)) {
  const output = `${JSON.stringify(
    z.toJSONSchema(schema, {
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "ref"
    }),
    null,
    2
  )}\n`;
  const target = resolve(outputDirectory, `${name}.schema.json`);

  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== output) {
      console.error(`schema drift: ${target}`);
      drift = true;
    }
  } else {
    await writeFile(target, output, "utf8");
  }
}

if (drift) {
  process.exitCode = 1;
}
