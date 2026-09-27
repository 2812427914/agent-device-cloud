import type { AccessService, Principal } from "../../apps/control-plane/src/access.ts";

/** Injectable identity fixture for dispatch API tests. Real authentication is
 * exercised independently by identity.e2e.test.ts against PostgreSQL. */
export function accessFixture(options: {
  cookie: string;
  origin?: string;
  agents?: Record<string, { accountId: string; grantId: string }>;
}): AccessService {
  return {
    origin: options.origin ?? "http://adc.test",
    async authenticate(request): Promise<Principal | undefined> {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      if (token) {
        const agent = options.agents?.[token];
        return agent ? { kind: "agent", ...agent } : undefined;
      }
      if (request.headers.cookie !== options.cookie) return;
      return {
        kind: "session",
        accountId: "acct_primary",
        account: { accountId: "acct_primary", userId: "test-user", name: "Test user" },
        user: { id: "test-user", name: "Test user", email: "test@example.com" }
      };
    }
  } as AccessService;
}
