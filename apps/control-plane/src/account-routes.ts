import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "@adc/db";
import { createId, ProtocolError } from "@adc/protocol";
import { grantContext, type AccessService, type Principal } from "./access.ts";

export function registerAccountRoutes(
  app: FastifyInstance,
  options: {
    access: AccessService;
    store: Store;
    requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAuthenticated: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    principal: (request: FastifyRequest) => Principal;
  }
) {
  const { store, access, principal } = options;
  const identity = access.identity;
  const owner = { preHandler: options.requireSession };
  const audit = async (request: FastifyRequest, type: string, payload: Record<string, unknown>) => {
    await store.putAudit({
      eventId: createId("dsp"),
      accountId: principal(request).accountId,
      type,
      payload,
      createdAt: new Date().toISOString()
    });
  };
  app.get("/api/v1/me", { preHandler: options.requireAuthenticated }, async (request) => {
    const actor = principal(request);
    if (actor.kind === "session")
      return {
        kind: "session",
        user: actor.user,
        account: actor.account
      };
    const grant = await store.getGrant(actor.grantId);
    if (!grant || grant.accountId !== actor.accountId || grant.revokedAt) {
      throw new ProtocolError("denied", "Agent authorization is unavailable.", false);
    }
    return {
      kind: "agent",
      context: grantContext(grant, await store.listNodes(actor.accountId)),
      grant
    };
  });
  app.get("/api/v1/grants", owner, async (request) => {
    const accountId = principal(request).accountId;
    const nodes = await store.listNodes(accountId);
    return {
      grants: (await store.listGrants(accountId)).map((grant) => ({
        ...grant,
        resourcesByNode: grantContext(grant, nodes).resourcesByNode
      }))
    };
  });
  app.post("/api/v1/grants/:grantId/revoke", owner, async (request) => {
    const { grantId } = z.object({ grantId: z.string() }).parse(request.params);
    if (!(await store.revokeGrant(principal(request).accountId, grantId, new Date()))) {
      throw new ProtocolError("not_found", "Agent authorization was not found.", false);
    }
    await audit(request, "grant.revoked", { grantId });
    return { revoked: true };
  });
  app.get("/api/v1/credentials", owner, async (request) => ({
    credentials: await identity.listCredentials(principal(request).accountId)
  }));
  app.post("/api/v1/credentials", owner, async (request) => {
    const body = z
      .object({
        name: z.string().min(1).max(128),
        grantId: z.string(),
        expiresInDays: z.number().int().min(1).max(365).default(30)
      })
      .strict()
      .parse(request.body);
    const result = await identity.createCredential(
      principal(request).accountId,
      body.grantId,
      body.name,
      new Date(Date.now() + body.expiresInDays * 86400_000)
    );
    await audit(request, "credential.created", {
      credentialId: result.credential.credentialId,
      grantId: body.grantId
    });
    return result;
  });
  app.post("/api/v1/credentials/:credentialId/revoke", owner, async (request) => {
    const { credentialId } = z.object({ credentialId: z.string() }).parse(request.params);
    if (!(await identity.revokeCredential(principal(request).accountId, credentialId))) {
      throw new ProtocolError("not_found", "Credential was not found.", false);
    }
    await audit(request, "credential.revoked", { credentialId });
    return { revoked: true };
  });
  app.post("/api/v1/oauth/bindings", owner, async (request) => {
    const actor = principal(request);
    if (actor.kind !== "session")
      throw new ProtocolError("denied", "User session required.", false);
    const { clientId, grantId } = z
      .object({
        clientId: z.string().min(1).max(512),
        grantId: z.string()
      })
      .strict()
      .parse(request.body);
    await identity.bindOAuthClient(actor.user.id, actor.accountId, clientId, grantId);
    await audit(request, "oauth.bound", { clientId, grantId });
    return { bound: true };
  });
  app.get("/api/v1/oauth/bindings", owner, async (request) => ({
    bindings: await identity.listOAuthBindings(principal(request).accountId)
  }));
  app.post("/api/v1/oauth/bindings/revoke", owner, async (request) => {
    const actor = principal(request);
    if (actor.kind !== "session")
      throw new ProtocolError("denied", "User session required.", false);
    const { clientId } = z
      .object({ clientId: z.string().min(1).max(512) })
      .strict()
      .parse(request.body);
    await identity.revokeOAuthBinding(actor.accountId, clientId);
    await access.authentication.revokeOAuthTokens(actor.user.id, clientId);
    await audit(request, "oauth.revoked", { clientId });
    return { revoked: true };
  });
}
