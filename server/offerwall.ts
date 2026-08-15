import crypto from "node:crypto";
import type { Request, Response } from "express";
import { getOfferwallProviderByKey, processOfferwallReward } from "./db";

export type OfferwallSignatureMode = "hmac_body" | "hmac_query";

export type OfferwallProviderSecurity = {
  signatureMode: OfferwallSignatureMode;
  signatureHeader: string;
  signatureField: string;
  allowedIps?: string | null;
};

export type OfferwallProviderMapping = {
  transactionIdField: string;
  userIdField: string;
  amountField: string;
  offerNameField: string;
};

export type OfferwallReward = {
  transactionId: string;
  userId: number;
  amount: number;
  offerName: string | null;
};

export function safeEqual(expected: string, received: string) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isAllowedOfferwallIp(
  remoteIp: string | undefined,
  allowedIps?: string | null
) {
  const ips = (allowedIps || "")
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean);
  return ips.length === 0 || (!!remoteIp && ips.includes(remoteIp));
}

export function isOfferwallProviderReady(
  provider: { secretEnvKey?: string | null } | undefined,
  secret: string | undefined
) {
  return Boolean(provider?.secretEnvKey && secret);
}

export function queryWithoutField(rawQuery: string, field: string) {
  return rawQuery
    .split("&")
    .filter(part => decodeURIComponent(part.split("=", 1)[0] || "") !== field)
    .join("&");
}

export function isValidOfferwallSignature(
  secret: string,
  rawBody: Buffer,
  rawQuery: string,
  received: string,
  config: OfferwallProviderSecurity
) {
  const signedValue =
    config.signatureMode === "hmac_query"
      ? queryWithoutField(rawQuery, config.signatureField)
      : rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedValue)
    .digest("hex");
  return safeEqual(expected, received);
}

export function valueAtPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    return (value as Record<string, unknown>)[segment];
  }, payload);
}

export function extractOfferwallReward(
  payload: Record<string, unknown>,
  mapping: OfferwallProviderMapping
): OfferwallReward {
  const transactionId = String(
    valueAtPath(payload, mapping.transactionIdField) || ""
  ).trim();
  const userId = Number(valueAtPath(payload, mapping.userIdField));
  const amount = Number(valueAtPath(payload, mapping.amountField));
  const rawOfferName = valueAtPath(payload, mapping.offerNameField);
  const offerName =
    typeof rawOfferName === "string" && rawOfferName.trim()
      ? rawOfferName.trim().slice(0, 255)
      : null;
  if (!transactionId || !Number.isInteger(userId) || userId <= 0)
    throw new Error("Invalid postback user or transaction");
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("Invalid postback amount");
  return { transactionId, userId, amount, offerName };
}

type PostbackDependencies = {
  getProvider: typeof getOfferwallProviderByKey;
  processReward: typeof processOfferwallReward;
  getSecret: (envKey: string) => string | undefined;
};

export function createOfferwallPostbackHandler(
  dependencies: PostbackDependencies = {
    getProvider: getOfferwallProviderByKey,
    processReward: processOfferwallReward,
    getSecret: envKey => process.env[envKey],
  }
) {
  return async function handleOfferwallPostback(req: Request, res: Response) {
    const providerKey = String(req.params.providerKey || "").trim();
    const provider = await dependencies.getProvider(providerKey);
    if (!provider || !provider.secretEnvKey) {
      res.status(404).json({ error: "Unknown or unconfigured provider" });
      return;
    }
    const secret = dependencies.getSecret(provider.secretEnvKey);
    if (!isOfferwallProviderReady(provider, secret) || !secret) {
      res.status(503).json({ error: "Provider is not ready" });
      return;
    }
    const remoteIp = req.socket.remoteAddress?.replace(/^::ffff:/, "");
    if (!isAllowedOfferwallIp(remoteIp, provider.allowedIps)) {
      res.status(403).json({ error: "Source IP is not allowed" });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(String(req.body || ""), "utf8");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }
    const rawQuery = req.originalUrl.split("?", 2)[1] || "";
    const receivedSignature =
      provider.signatureMode === "hmac_query"
        ? String(req.query[provider.signatureField] || "")
        : req.get(provider.signatureHeader) || "";
    if (
      !receivedSignature ||
      !isValidOfferwallSignature(
        secret,
        rawBody,
        rawQuery,
        receivedSignature,
        provider
      )
    ) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    try {
      const reward = extractOfferwallReward(payload, provider);
      const payloadHash = crypto
        .createHash("sha256")
        .update(rawBody)
        .digest("hex");
      const result = await dependencies.processReward(
        provider.id,
        reward,
        payloadHash
      );
      res.status(200).json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      res.status(422).json({
        error:
          error instanceof Error ? error.message : "Invalid reward payload",
      });
    }
  };
}

export const handleOfferwallPostback = createOfferwallPostbackHandler();
