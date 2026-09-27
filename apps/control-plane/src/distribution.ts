import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface NodeDistribution {
  directory: string;
  publicUrl: string;
  downloadUrl?: string;
}

export function distributionInfo(distribution?: NodeDistribution) {
  if (!distribution) return { available: false };
  const controlPlaneUrl = new URL(distribution.publicUrl).origin;
  const downloadUrl = distribution.downloadUrl
    ? new URL(distribution.downloadUrl).href.replace(/\/$/, "")
    : `${controlPlaneUrl}/downloads/node`;
  const parsed = new URL(downloadUrl);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      ))
  ) {
    throw new Error(
      "ADC_NODE_DOWNLOAD_URL must be HTTPS or loopback HTTP, without credentials/query/hash."
    );
  }
  return {
    available:
      !!distribution.downloadUrl || existsSync(resolve(distribution.directory, "install.sh")),
    controlPlaneUrl,
    downloadUrl,
    installerUrl: `${downloadUrl}/install.sh`
  };
}

export function registerDistributionRoutes(app: FastifyInstance, distribution?: NodeDistribution) {
  distributionInfo(distribution); // Validate configured URLs before accepting requests.
  async function serve(file: string, reply: FastifyReply) {
    const allowed =
      ["install.sh", "manifest.json", "SHA256SUMS"].includes(file) ||
      /^adc-[a-zA-Z0-9._-]+-(darwin|linux)-(arm64|x64)-[a-f0-9]{16}\.tar\.gz$/.test(file);
    if (!distribution || !allowed)
      return reply.code(404).send({ error: "Release file not found." });
    const path = resolve(distribution.directory, file);
    try {
      if (!(await stat(path)).isFile())
        return reply.code(404).send({ error: "Release file not found." });
    } catch {
      return reply.code(404).send({
        error: "Release is not built. Run pnpm build:node or configure ADC_NODE_DOWNLOAD_URL."
      });
    }
    reply.header(
      "cache-control",
      file.endsWith(".tar.gz") ? "public, max-age=31536000, immutable" : "no-cache"
    );
    reply.type(
      file.endsWith(".tar.gz")
        ? "application/gzip"
        : file.endsWith(".json")
          ? "application/json"
          : "text/plain; charset=utf-8"
    );
    return reply.send(createReadStream(path));
  }
  app.get("/install.sh", async (_request, reply) => serve("install.sh", reply));
  app.get(
    "/downloads/node/:file",
    async (request: FastifyRequest<{ Params: { file: string } }>, reply) =>
      serve(request.params.file, reply)
  );
}
