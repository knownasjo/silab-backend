import crypto from "crypto";
import { env } from "../../config/env.config";
import { InternalServerError } from "../HttpErrors/HttptErrors";
import { isMailConfigured, sendMail } from "../Mailer/mailer";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;

const codeKey = crypto
  .createHmac("sha256", env.JWT.SECRET)
  .update("silab-verification-code")
  .digest();

export const generateVerificationCode = () =>
  crypto.randomInt(0, 1000000).toString().padStart(6, "0");

export const hashVerificationCode = (email: string, code: string) =>
  crypto.createHmac("sha256", codeKey).update(`${email}:${code}`).digest("hex");

export const isSameVerificationCode = (
  hash: string,
  email: string,
  code: string
) => {
  const expected = Buffer.from(hash, "hex");
  const received = Buffer.from(hashVerificationCode(email, code), "hex");

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );

export type VerificationPurpose = "registration" | "password-reset";

const MAIL_TEXT: Record<
  VerificationPurpose,
  { label: string; subject: string; intro: string; ignore: string }
> = {
  registration: {
    label: "Kode verifikasi",
    subject: "adalah kode verifikasi SILAB Anda",
    intro: "Kode verifikasi pendaftaran akun SILAB Anda:",
    ignore: "Jika Anda tidak merasa mendaftar di SILAB, abaikan email ini.",
  },
  "password-reset": {
    label: "Kode reset password",
    subject: "adalah kode reset password SILAB Anda",
    intro: "Kode untuk mengganti password akun SILAB Anda:",
    ignore:
      "Jika Anda tidak meminta reset password, abaikan email ini. Password Anda tidak berubah.",
  },
};

export const sendVerificationCode = async (
  email: string,
  fullname: string,
  code: string,
  purpose: VerificationPurpose = "registration"
) => {
  const content = MAIL_TEXT[purpose];

  if (!isMailConfigured()) {
    if (env.IS_PRODUCTION)
      throw new InternalServerError("Layanan email belum dikonfigurasi!");

    console.info(`[SILAB] ${content.label} untuk ${email}: ${code}`);
    return;
  }

  const minutes = CODE_TTL_MS / 60000;
  const name = escapeHtml(fullname);

  try {
    await sendMail({
      to: email,
      subject: `${code} ${content.subject}`,
      text: [
        `Halo ${fullname},`,
        "",
        content.intro,
        "",
        code,
        "",
        `Kode berlaku ${minutes} menit. Jangan berikan kode ini kepada siapa pun.`,
        "",
        content.ignore,
      ].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;color:#1D1D1D;max-width:480px">
<p>Halo ${name},</p>
<p>${content.intro}</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#3272CA">${code}</p>
<p>Kode berlaku ${minutes} menit. Jangan berikan kode ini kepada siapa pun.</p>
<p style="color:#5E6278;font-size:13px">${content.ignore}</p>
</div>`,
    });
  } catch (error) {
    console.error("[SILAB] Gagal mengirim email verifikasi:", error);
    throw new InternalServerError(
      "Gagal mengirim email verifikasi, coba lagi nanti."
    );
  }
};
