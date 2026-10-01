import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";

function canonicalJson(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function nodeRequestPayload(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body?: unknown;
}): string {
  const bodyHash = createHash("sha256").update(canonicalJson(input.body)).digest("hex");
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, bodyHash].join(
    "\n"
  );
}

export function generateNodeKeyPair(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function signNodeRequest(
  privateKey: string,
  input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body?: unknown;
  }
): string {
  const key = createPrivateKey(privateKey);
  const algorithm = key.asymmetricKeyType === "ec" ? "sha256" : null;
  return sign(algorithm, Buffer.from(nodeRequestPayload(input)), key).toString("base64url");
}

export function verifyNodeRequest(
  publicKey: string,
  signature: string,
  input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body?: unknown;
  }
): boolean {
  try {
    const key = createPublicKey(publicKey);
    const algorithm = key.asymmetricKeyType === "ec" ? "sha256" : null;
    return verify(
      algorithm,
      Buffer.from(nodeRequestPayload(input)),
      key,
      Buffer.from(signature, "base64url")
    );
  } catch {
    return false;
  }
}
