import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * Opt-in cross-origin access for API consumers such as harness plugins.
 *
 * ADC never allows cross-origin cookies: `Access-Control-Allow-Credentials` is
 * deliberately absent, so browser sessions keep the same-origin deployment
 * posture and Bearer credentials (Agent access keys, owner PATs) are the only
 * cross-origin authentication paths. Requests without an `Origin` header
 * (CLI, SDK, MCP clients) are untouched.
 */

const ALLOW_METHODS = "GET, HEAD, POST, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS =
  "authorization, content-type, mcp-protocol-version, mcp-session-id, mcp-last-event-id";
const MAX_AGE_SECONDS = "600";

export interface CorsOptions {
  /**
   * `"*"` reflects any request origin (public API deployments).
   * A list must contain exact origins, e.g. `["https://workbench.local"]`.
   */
  origins: string[] | "*";
}

export function parseCorsOrigins(input: string | undefined): CorsOptions["origins"] | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  if (value === "*") return "*";
  const origins = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!origins.length) return undefined;
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `ADC_CORS_ORIGINS contains an invalid origin "${origin}". Use https://host[:port] entries separated by commas, or *.`
      );
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.pathname !== "/") {
      throw new Error(
        `ADC_CORS_ORIGINS entry "${origin}" must be an origin without a path, query or credentials.`
      );
    }
  }
  return origins;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": ALLOW_METHODS,
    "access-control-allow-headers": ALLOW_HEADERS,
    "access-control-max-age": MAX_AGE_SECONDS
  };
}

function joinVary(existing: unknown, value: string): string {
  if (!existing) return value;
  const parts = String(existing)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) parts.push(value);
  return parts.join(", ");
}

export function registerCors(app: FastifyInstance, options: CorsOptions): void {
  const allowed = new Set(
    options.origins === "*" ? [] : options.origins.map((origin) => origin.toLowerCase())
  );
  const allowAny = options.origins === "*";

  const resolveOrigin = (request: FastifyRequest): string | undefined => {
    const header = request.headers.origin;
    if (!header || Array.isArray(header)) return undefined;
    const origin = header.trim().toLowerCase();
    if (!origin || origin === "null") return undefined;
    return allowAny || allowed.has(origin) ? origin : undefined;
  };

  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "OPTIONS") return;
    const origin = resolveOrigin(request);
    if (!origin) return;
    void reply.code(204);
    for (const [name, value] of Object.entries(corsHeaders(origin))) reply.header(name, value);
    return reply.send();
  });

  app.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const origin = resolveOrigin(request);
    if (!origin) return payload;
    for (const [name, value] of Object.entries(corsHeaders(origin))) reply.header(name, value);
    reply.header("vary", joinVary(reply.getHeader("vary"), "Origin"));
    return payload;
  });
}
