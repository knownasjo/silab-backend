import crypto from "crypto";
import { env } from "../../config/env.config";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 6;
const TOKEN_SPACE = ALPHABET.length ** TOKEN_LENGTH;

const EXPIRED_LOOKBACK_MS = 10 * 60 * 1000;

const qrKey = crypto
  .createHmac("sha256", env.JWT.SECRET)
  .update("silab-qr-token")
  .digest();

const periodMs = () => env.QR.PERIOD_SECONDS * 1000;

const stepAt = (timeMs: number) => Math.floor(timeMs / periodMs());

const tokenForStep = (meetingId: string, step: number): string => {
  const digest = crypto
    .createHmac("sha256", qrKey)
    .update(`${meetingId}:${step}`)
    .digest();

  let value = digest.readUIntBE(0, 6) % TOKEN_SPACE;
  let token = "";

  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token = ALPHABET[value % ALPHABET.length] + token;
    value = Math.floor(value / ALPHABET.length);
  }

  return token;
};

const isSameToken = (expected: string, received: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const getCurrentQrToken = (meetingId: string, now = Date.now()) => {
  const step = stepAt(now);

  return {
    token: tokenForStep(meetingId, step),
    periodSeconds: env.QR.PERIOD_SECONDS,
    expiresInMs: (step + 1) * periodMs() - now,
  };
};

export type QrTokenStatus = "VALID" | "EXPIRED" | "INVALID";

export const checkQrToken = (
  meetingId: string,
  token: string,
  now = Date.now()
): QrTokenStatus => {
  const step = stepAt(now);

  if (
    isSameToken(tokenForStep(meetingId, step), token) ||
    isSameToken(tokenForStep(meetingId, step - 1), token)
  )
    return "VALID";

  const lookbackSteps = Math.ceil(EXPIRED_LOOKBACK_MS / periodMs());

  for (let past = step - 2; past >= step - lookbackSteps; past--) {
    if (isSameToken(tokenForStep(meetingId, past), token)) return "EXPIRED";
  }

  return "INVALID";
};
