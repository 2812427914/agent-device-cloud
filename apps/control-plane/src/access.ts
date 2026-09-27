import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAPIError } from "better-auth/api";
import {
  IdentityStore,
  type AgentGrantRecord,
  type NodeRecord,
  type PersonalAccount
} from "@adc/db";
import { ProtocolError, type ToolCapability, type ToolId } from "@adc/protocol";
import type { Authentication } from "./auth.ts";
import { effectiveCapability } from "./resource-management.ts";

export type Principal =
  | {
      kind: "session";
      accountId: string;
      user: { id: string; name: string; email: string };
      account: PersonalAccount;
    }
  | { kind: "agent"; accountId: string; grantId: string; credentialId?: string; clientId?: string };

export interface AccessService {
  origin: string;
  identity: IdentityStore;
  authentication: Authentication;
  authenticate(request: FastifyRequest): Promise<Principal | undefined>;
}

function headersFor(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value !== undefined &&
      name !== "x-adc-client-ip" &&
      name !== "host" &&
      !name.startsWith("x-forwarded-") &&
      name !== "forwarded"
    ) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  headers.set("x-adc-client-ip", request.ip);
  return headers;
}

async function forwardResponse(response: Response, reply: FastifyReply) {
  reply.code(response.status);
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-length") reply.header(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header("set-cookie", cookies);
  return reply.send(Buffer.from(await response.arrayBuffer()));
}

export function createAccessService(
  authentication: Authentication,
  identity: IdentityStore
): AccessService {
  return {
    authentication,
    identity,
    origin: authentication.origin,
    async authenticate(request) {
      const authorization = request.headers.authorization;
      if (authorization !== undefined) {
        if (!authorization.startsWith("Bearer ")) return;
        const token = authorization.slice(7);
        if (token.startsWith("adc_oat_")) {
          let claims;
          try {
            claims = await authentication.verifyAccessToken(token);
          } catch (error) {
            if (
              isAPIError(error) &&
              [401, 400, 403, "UNAUTHORIZED", "BAD_REQUEST", "FORBIDDEN"].includes(error.status)
            )
              return;
            throw error;
          }
          const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
          if (
            !audiences.includes(authentication.resource) ||
            claims.iss !== authentication.issuer ||
            typeof claims.scope !== "string" ||
            !claims.scope.split(" ").includes("adc:tools") ||
            typeof claims.sub !== "string" ||
            typeof claims.client_id !== "string" ||
            typeof claims.adc_binding !== "string"
          )
            return;
          const binding = await identity.oauthBinding(
            claims.sub,
            claims.client_id,
            claims.adc_binding
          );
          return binding ? { kind: "agent", ...binding, clientId: claims.client_id } : undefined;
        }
        const credential = await identity.authenticateCredential(token);
        return credential
          ? {
              kind: "agent",
              accountId: credential.accountId,
              grantId: credential.grantId,
              credentialId: credential.credentialId
            }
          : undefined;
      }
      const session = await authentication.auth.api.getSession!({ headers: headersFor(request) });
      if (!session) return;
      const account = await identity.accountForUser(session.user.id, session.user.name);
      return {
        kind: "session",
        accountId: account.accountId,
        account,
        user: { id: session.user.id, name: session.user.name, email: session.user.email }
      };
    }
  };
}

export function registerAuthenticationRoutes(app: FastifyInstance, access: AccessService) {
  const { authentication } = access;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    bodyLimit: 64 * 1024,
    async handler(request, reply) {
      const headers = headersFor(request);
      const url = new URL(request.url, access.origin);
      // Never construct password-reset or OAuth links from an untrusted Host.
      url.protocol = new URL(access.origin).protocol;
      url.host = new URL(access.origin).host;
      const body =
        request.method === "GET"
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body ?? {});
      const response = await authentication.handle(
        new Request(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body })
        })
      );
      return forwardResponse(response, reply);
    }
  });
  app.get("/api/v1/auth/config", async () => ({
    registrationEnabled: authentication.registrationEnabled,
    passwordResetEnabled: authentication.passwordResetEnabled,
    githubEnabled: authentication.githubEnabled,
    requireEmailVerification: authentication.requireEmailVerification
  }));
  const metadata = async (request: FastifyRequest, reply: FastifyReply) =>
    forwardResponse(
      await authentication.metadata(
        new Request(new URL(request.url, access.origin), { headers: headersFor(request) })
      ),
      reply
    );
  app.get("/.well-known/oauth-authorization-server", metadata);
  app.get("/.well-known/oauth-authorization-server/api/auth", metadata);
  app.get("/.well-known/oauth-protected-resource/mcp", async () => ({
    resource: authentication.resource,
    authorization_servers: [authentication.issuer],
    scopes_supported: ["adc:tools", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_name: "Agent Device Cloud"
  }));
}

export function grantContext(grant: AgentGrantRecord, nodes: NodeRecord[] = []) {
  const grantedNodes = nodes.filter(
    (node) =>
      node.accountId === grant.accountId &&
      grant.nodeIds.includes(node.nodeId) &&
      node.status === "active"
  );
  const effectiveCapabilities = new Map(
    grantedNodes.map((node) => [node.nodeId, effectiveCapability(node)] as const)
  );
  const resourcesByNode = Object.fromEntries(
    grantedNodes.map((node) => [
      node.nodeId,
      (effectiveCapabilities.get(node.nodeId)?.roots ?? [])
        .filter((root) => grant.rootAccess === "all" || grant.rootIds.includes(root.rootId))
        .map((root) => ({
          rootId: root.rootId,
          ...(root.path ? { path: root.path } : {})
        }))
    ])
  );
  const rootsByNode = Object.fromEntries(
    Object.entries(resourcesByNode).map(([nodeId, resources]) => [
      nodeId,
      resources.map((resource) => resource.rootId)
    ])
  );
  const toolNodeIds = Object.fromEntries(
    grant.allowedTools.map((tool) => [
      tool,
      grantedNodes
        .filter((node) =>
          effectiveCapabilities
            .get(node.nodeId)
            ?.tools.some((advertised) => advertised.name === tool)
        )
        .map((node) => node.nodeId)
        .sort()
    ])
  ) as Partial<Record<ToolId, string[]>>;
  const toolDefinitions = Object.fromEntries(
    grant.allowedTools.flatMap((tool) => {
      const definition = grantedNodes
        .flatMap((node) => effectiveCapabilities.get(node.nodeId)?.tools ?? [])
        .find((advertised) => advertised.name === tool);
      return definition ? [[tool, definition]] : [];
    })
  ) as Partial<Record<ToolId, ToolCapability>>;
  return {
    accountId: grant.accountId,
    actorId: grant.actorId,
    grantId: grant.grantId,
    ...(grant.projectId ? { projectId: grant.projectId } : {}),
    nodeIds: grant.nodeIds,
    allowedTools: grant.allowedTools,
    toolNodeIds,
    toolDefinitions,
    rootAccess: grant.rootAccess ?? ("selected" as const),
    rootsByNode,
    resourcesByNode,
    rootIds:
      grant.rootAccess === "all" ? [...new Set(Object.values(rootsByNode).flat())] : grant.rootIds
  };
}

export function assertSameOrigin(request: FastifyRequest, origin: string) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== origin) {
    throw new ProtocolError("denied", "A same-origin request is required.", false);
  }
}
