import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nodeRequestPayload, signNodeRequest, verifyNodeRequest } from "./node-auth.ts";

describe("node request proofs", () => {
  it("supports Android Keystore-compatible P-256 identities", () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const request = {
      method: "POST",
      path: "/api/v1/nodes/node_android/poll",
      timestamp: "2026-10-01T00:00:00.000Z",
      nonce: "abcdefghijklmnop",
      body: { claim: true, activeTaskCount: 0 }
    };

    const signature = signNodeRequest(privateKey, request);

    expect(verifyNodeRequest(publicKey, signature, request)).toBe(true);
    expect(verifyNodeRequest(publicKey, signature, { ...request, body: { claim: false } })).toBe(
      false
    );
  });

  it("uses stable canonical JSON in the signed payload", () => {
    const payload = nodeRequestPayload({
      method: "post",
      path: "/poll",
      timestamp: "2026-10-01T00:00:00Z",
      nonce: "abcdefghijklmnop",
      body: { b: 2, a: { z: true, y: ["x", null] } }
    });

    expect(payload.split("\n")).toEqual([
      "POST",
      "/poll",
      "2026-10-01T00:00:00Z",
      "abcdefghijklmnop",
      "e1c4eb1b358344b9f58ff65ea5ef3f986a5086b4b1c389720f01658640f70f59"
    ]);
  });
});
