import crypto from "crypto";
import { env } from "../../config/env.config";

/**
 * Token QR presensi yang berganti otomatis, dengan pola TOTP (RFC 6238).
 *
 * Token tidak disimpan di database. Token dihitung dari
 * HMAC-SHA256(kunci server, "<meetingId>:<nomor periode>"), dengan
 * nomor periode = floor(waktu / panjang periode). Tanpa kunci server, token
 * berikutnya tidak bisa ditebak, sehingga foto QR hanya berlaku sebentar.
 * Karena QR yang ditampilkan dan validasinya sama-sama dihitung dari jam
 * server, keduanya tidak mungkin berbeda.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 6;
const TOKEN_SPACE = ALPHABET.length ** TOKEN_LENGTH; // 62^6 ≈ 5,7 × 10^10

/** Token yang lebih tua dari ini dianggap tidak valid, bukan kedaluwarsa. */
const EXPIRED_LOOKBACK_MS = 10 * 60 * 1000;

// Kunci turunan dari JWT_SECRET, supaya kunci HMAC QR terpisah dari kunci
// penanda tangan JWT tanpa perlu variabel .env baru.
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

  // 48 bit pertama cukup untuk 62^6 kemungkinan dan masih aman sebagai number.
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

/**
 * Token periode sekarang dan satu periode sebelumnya sama-sama sah, supaya
 * mahasiswa yang memindai tepat sebelum QR berganti tidak ditolak. Jadi
 * sejak QR tampil, token berlaku antara 1 sampai 2 periode.
 */
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
