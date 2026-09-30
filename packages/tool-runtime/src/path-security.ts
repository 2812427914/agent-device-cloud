import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ProtocolError, ErrorCodes, ResourcePathSchema } from "@adc/protocol";

const defaultSensitiveSegments = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".npmrc",
  ".netrc",
  ".env",
  "credentials"
]);

export interface LocalRoot {
  rootId: string;
  path: string;
  writable: boolean;
  label?: string | undefined;
  allowSensitivePaths?: boolean;
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function assertNotSensitive(resourcePath: string): void {
  const denied = resourcePath
    .split("/")
    .find((segment) => defaultSensitiveSegments.has(segment.toLowerCase()));
  if (denied) {
    throw new ProtocolError(
      ErrorCodes.DENIED,
      `resource path contains a protected segment: ${denied}`,
      false,
      { reasonCode: "path.sensitive" }
    );
  }
}

async function closestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

export async function resolveResourcePath(
  root: LocalRoot,
  resourcePath: string,
  mode: "read" | "write"
): Promise<string> {
  const parsedPath = ResourcePathSchema.parse(resourcePath);
  if (!root.allowSensitivePaths) assertNotSensitive(parsedPath);

  const rootRealPath = await realpath(root.path);
  const lexicalCandidate = resolve(rootRealPath, parsedPath);
  if (!isWithin(rootRealPath, lexicalCandidate)) {
    throw new ProtocolError(ErrorCodes.DENIED, "resource path escapes the selected root", false, {
      reasonCode: "path.escape"
    });
  }

  if (mode === "write" && !root.writable) {
    throw new ProtocolError(ErrorCodes.DENIED, "selected root is read-only", false, {
      reasonCode: "root.read_only"
    });
  }

  try {
    const candidateRealPath = await realpath(lexicalCandidate);
    if (!isWithin(rootRealPath, candidateRealPath)) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "resource path resolves outside the selected root",
        false,
        { reasonCode: "path.symlink_escape" }
      );
    }
    if (!root.allowSensitivePaths)
      assertNotSensitive(relative(rootRealPath, candidateRealPath).split(sep).join("/"));
    return candidateRealPath;
  } catch (error: any) {
    if (error instanceof ProtocolError) {
      throw error;
    }
    if (error?.code !== "ENOENT" || mode === "read") {
      throw error;
    }
  }

  const ancestor = await closestExistingAncestor(dirname(lexicalCandidate));
  const ancestorRealPath = await realpath(ancestor);
  if (!isWithin(rootRealPath, ancestorRealPath)) {
    throw new ProtocolError(
      ErrorCodes.DENIED,
      "resource parent resolves outside the selected root",
      false,
      { reasonCode: "path.symlink_escape" }
    );
  }
  if (!root.allowSensitivePaths)
    assertNotSensitive(relative(rootRealPath, ancestorRealPath).split(sep).join("/"));
  return lexicalCandidate;
}

/** O_NOFOLLOW closes final-component symlink replacement. Parent directories are
 * revalidated after opening; portable Node APIs do not provide openat2, so this
 * remains a trusted-local-filesystem boundary, not an OS sandbox. */
export async function readResourceFile(
  root: LocalRoot,
  resourcePath: string,
  maxBytes: number
): Promise<string> {
  const target = await resolveResourcePath(root, resourcePath, "read");
  const handle = await open(
    target,
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const metadata = await handle.stat();
    const checked = await resolveResourcePath(root, resourcePath, "read");
    const current = await lstat(checked);
    if (checked !== target || current.dev !== metadata.dev || current.ino !== metadata.ino) {
      throw new ProtocolError(ErrorCodes.CONFLICT, "resource changed during access", true);
    }
    if (!metadata.isFile()) {
      throw new ProtocolError(ErrorCodes.INVALID_REQUEST, "resource is not a regular file", false);
    }
    if (metadata.size > maxBytes) {
      throw new ProtocolError(
        ErrorCodes.INVALID_REQUEST,
        "file exceeds the requested limit",
        false
      );
    }
    // Read a bounded buffer even if another process grows the file after stat.
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes <= maxBytes) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
    }
    if (bytes > maxBytes) {
      throw new ProtocolError(
        ErrorCodes.INVALID_REQUEST,
        "file exceeds the requested limit",
        false
      );
    }
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose portable directory fsync semantics through Node.
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /((?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]"
    );
}
