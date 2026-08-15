import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createOfferwallPostbackHandler,
  extractOfferwallReward,
  isAllowedOfferwallIp,
  isOfferwallProviderReady,
  isValidOfferwallSignature,
  queryWithoutField,
  safeEqual,
} from "./offerwall";

const security = {
  signatureMode: "hmac_body" as const,
  signatureHeader: "signature",
  signatureField: "signature",
};

describe("offerwall postback security", () => {
  it("does not process a reward when the configured provider has no secret", async () => {
    const processReward = vi.fn();
    const handler = createOfferwallPostbackHandler({
      getProvider: vi.fn().mockResolvedValue({
        id: 3,
        secretEnvKey: "OFFERWALL_TOROX_SECRET",
      } as any),
      processReward,
      getSecret: () => undefined,
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await handler(
      {
        params: { providerKey: "torox" },
        socket: {},
      } as any,
      { status, json } as any
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: "Provider is not ready" });
    expect(processReward).not.toHaveBeenCalled();
  });

  it("does not process a reward when the HMAC signature is invalid", async () => {
    const processReward = vi.fn();
    const handler = createOfferwallPostbackHandler({
      getProvider: vi.fn().mockResolvedValue({
        id: 3,
        secretEnvKey: "OFFERWALL_TOROX_SECRET",
        allowedIps: null,
        signatureMode: "hmac_body",
        signatureHeader: "x-orbit-signature",
        signatureField: "signature",
      } as any),
      processReward,
      getSecret: () => "correct-secret",
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await handler(
      {
        params: { providerKey: "torox" },
        socket: {},
        body: Buffer.from('{"transactionId":"tx-1","userId":7,"amount":500}'),
        originalUrl: "/api/offerwall/postback/torox",
        query: {},
        get: () => "not-a-valid-signature",
      } as any,
      { status, json } as any
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Invalid signature" });
    expect(processReward).not.toHaveBeenCalled();
  });

  it("keeps every provider closed until its server-only secret is configured", () => {
    expect(isOfferwallProviderReady(undefined, undefined)).toBe(false);
    expect(
      isOfferwallProviderReady({ secretEnvKey: "OFFERWALL_SECRET" }, undefined)
    ).toBe(false);
    expect(
      isOfferwallProviderReady({ secretEnvKey: "OFFERWALL_SECRET" }, "secret")
    ).toBe(true);
  });

  it("accepts only the HMAC-SHA256 signature for the exact raw body", () => {
    const body = Buffer.from(
      '{"transactionId":"tx-1","userId":7,"amount":500}'
    );
    const signature = crypto
      .createHmac("sha256", "test-secret")
      .update(body)
      .digest("hex");
    expect(
      isValidOfferwallSignature("test-secret", body, "", signature, security)
    ).toBe(true);
    expect(
      isValidOfferwallSignature(
        "test-secret",
        body,
        "",
        `${signature}0`,
        security
      )
    ).toBe(false);
  });

  it("removes only the signature from query-mode input and guards allowed IPs", () => {
    expect(queryWithoutField("id=1&signature=abc&user=7", "signature")).toBe(
      "id=1&user=7"
    );
    expect(
      isAllowedOfferwallIp("203.0.113.7", "203.0.113.7, 198.51.100.4")
    ).toBe(true);
    expect(isAllowedOfferwallIp("203.0.113.8", "203.0.113.7")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("extracts a valid mapped reward and rejects client-controlled malformed values", () => {
    const mapping = {
      transactionIdField: "data.conversionId",
      userIdField: "data.playerId",
      amountField: "data.amount",
      offerNameField: "data.offerName",
    };
    expect(
      extractOfferwallReward(
        {
          data: {
            conversionId: "conv-42",
            playerId: 7,
            amount: 1250,
            offerName: "Reach level 20",
          },
        },
        mapping
      )
    ).toEqual({
      transactionId: "conv-42",
      userId: 7,
      amount: 1250,
      offerName: "Reach level 20",
    });
    expect(() =>
      extractOfferwallReward(
        { data: { conversionId: "", playerId: 7, amount: -1 } },
        mapping
      )
    ).toThrow("Invalid postback");
  });
});
