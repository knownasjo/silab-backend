import { UserRole } from "@prisma/client";
import {
  CreateRefreshToken,
  CreateToken,
  VerifyRefreshToken,
} from "../helper/jwt.helper";
import {
  IRefreshTokenRequestBody,
  IRefreshTokenResponseBody,
  IRegistrationResponseBody,
  IResendRegistrationRequestBody,
  IUserLoginRequestBody,
  IUserLoginResponseBody,
  IUserRegisterRequestBody,
  IVerifyRegistrationRequestBody,
} from "../interfaces/auth.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  UnverifiedAccountError,
} from "../utils/HttpErrors/HttptErrors";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  generateVerificationCode,
  hashVerificationCode,
  isSameVerificationCode,
  sendVerificationCode,
} from "../utils/VerificationCode/verification.code";
import bcrypt from "bcryptjs";

const CAMPUS_EMAIL = /^[a-z]+(\d{10})@webmail\.uad\.ac\.id$/;
const MIN_PASSWORD_LENGTH = 8;

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const readEmail = (value: unknown) => readText(value).toLowerCase();

const createSession = (userId: string): IUserLoginResponseBody => ({
  accessToken: CreateToken({ id: userId }),
  refreshToken: CreateRefreshToken({ id: userId }),
});

const waitMessage = (sentAt: Date) => {
  const seconds = Math.ceil(
    (sentAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000
  );

  return seconds > 0
    ? `Tunggu ${seconds} detik sebelum meminta kode baru.`
    : null;
};

const findRegisteredUser = (email: string, nim: string) =>
  db.mst_user.findFirst({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { nim }],
    },
    select: { email: true },
  });

const conflictMessage = (registeredEmail: string, email: string) =>
  registeredEmail.toLowerCase() === email
    ? "Email sudah terdaftar, silakan login."
    : "NIM sudah terdaftar, silakan login.";

export const SUserLogin = async (
  body: IUserLoginRequestBody
): Promise<IBaseResponse<IUserLoginResponseBody>> => {
  try {
    const nim = readText(body?.nim);
    const password = typeof body?.password === "string" ? body.password : "";

    if (!nim || !password)
      throw new BadRequestError("NIM dan password wajib diisi!");

    const userData = await db.mst_user.findFirst({
      where: {
        nim,
      },
    });

    if (!userData) {
      const registration = await db.trn_registrations.findUnique({
        where: { nim },
      });

      if (
        registration &&
        (await bcrypt.compare(password, registration.password))
      )
        throw new UnverifiedAccountError(
          `Akun belum diverifikasi. Masukkan kode yang dikirim ke ${registration.email}.`,
          { email: registration.email }
        );

      throw new UnauthorizedError("NIM atau password salah!");
    }

    const isPassSame = await bcrypt.compare(password, userData.password);

    if (!isPassSame) throw new UnauthorizedError("NIM atau password salah!");

    return {
      status: true,
      message: "Login Successful",
      data: createSession(userData.id),
    };
  } catch (error: any) {
    throw error;
  }
};

export const SRefreshAccessToken = async (
  body: IRefreshTokenRequestBody
): Promise<IBaseResponse<IRefreshTokenResponseBody>> => {
  const refreshToken = body?.refreshToken;

  if (typeof refreshToken !== "string" || !refreshToken)
    throw new BadRequestError("Refresh token wajib dikirim!");

  const userId = VerifyRefreshToken(refreshToken);

  const user = userId
    ? await db.mst_user.findUnique({
        where: { id: userId },
        select: { id: true },
      })
    : null;

  if (!user)
    throw new UnauthorizedError("Sesi berakhir, silakan login kembali!");

  return {
    status: true,
    message: "Token berhasil diperbarui",
    data: {
      accessToken: CreateToken({ id: user.id }),
    },
  };
};

export const SRegisterUser = async (
  body: IUserRegisterRequestBody
): Promise<IBaseResponse<IRegistrationResponseBody>> => {
  const email = readEmail(body?.email);
  const fullname = readText(body?.fullname).replace(/\s+/g, " ");
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmPassword =
    typeof body?.confirmPassword === "string" ? body.confirmPassword : "";

  const nim = CAMPUS_EMAIL.exec(email)?.[1];

  if (!nim)
    throw new BadRequestError(
      "Gunakan email kampus dengan format namadepanNIM@webmail.uad.ac.id!"
    );

  if (fullname.length < 3 || fullname.length > 100)
    throw new BadRequestError("Nama lengkap harus 3 sampai 100 karakter!");

  if (password.length < MIN_PASSWORD_LENGTH)
    throw new BadRequestError(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter!`
    );

  if (password !== confirmPassword)
    throw new BadRequestError("Konfirmasi password tidak sama!");

  const registeredUser = await findRegisteredUser(email, nim);

  if (registeredUser)
    throw new ConflictError(conflictMessage(registeredUser.email, email));

  const previous = await db.trn_registrations.findUnique({
    where: { email },
  });
  const wait = previous && waitMessage(previous.sent_at);

  if (wait) throw new TooManyRequestsError(wait);

  const code = generateVerificationCode();

  await sendVerificationCode(email, fullname, code);

  const now = Date.now();

  await db.$transaction([
    db.trn_registrations.deleteMany({
      where: { OR: [{ email }, { nim }] },
    }),
    db.trn_registrations.create({
      data: {
        email,
        nim,
        fullname,
        password: await bcrypt.hash(password, 10),
        code: hashVerificationCode(email, code),
        sent_at: new Date(now),
        expires_at: new Date(now + CODE_TTL_MS),
      },
    }),
  ]);

  return {
    status: true,
    message: `Kode verifikasi dikirim ke ${email}`,
    data: {
      email,
      nim,
      expires_in: CODE_TTL_MS / 1000,
      resend_in: RESEND_COOLDOWN_MS / 1000,
    },
  };
};

export const SVerifyRegistration = async (
  body: IVerifyRegistrationRequestBody
): Promise<IBaseResponse<IUserLoginResponseBody>> => {
  const email = readEmail(body?.email);
  const code = readText(body?.code);

  if (!email || !/^\d{6}$/.test(code))
    throw new BadRequestError("Masukkan 6 angka kode verifikasi!");

  const registration = await db.trn_registrations.findUnique({
    where: { email },
  });

  if (!registration)
    throw new NotFoundError("Pendaftaran tidak ditemukan, silakan daftar ulang.");

  if (registration.expires_at.getTime() < Date.now())
    throw new BadRequestError("Kode sudah kedaluwarsa, minta kode baru.");

  const { count } = await db.trn_registrations.updateMany({
    where: { id: registration.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });

  if (count === 0)
    throw new TooManyRequestsError(
      `Kode salah ${MAX_ATTEMPTS} kali, minta kode baru.`
    );

  if (!isSameVerificationCode(registration.code, email, code)) {
    const remaining = MAX_ATTEMPTS - registration.attempts - 1;

    throw new BadRequestError(
      remaining > 0
        ? `Kode salah. Sisa ${remaining} percobaan.`
        : `Kode salah ${MAX_ATTEMPTS} kali, minta kode baru.`
    );
  }

  const registeredUser = await findRegisteredUser(email, registration.nim);

  if (registeredUser)
    throw new ConflictError(conflictMessage(registeredUser.email, email));

  const [user] = await db.$transaction([
    db.mst_user.create({
      data: {
        email,
        nim: registration.nim,
        fullname: registration.fullname,
        password: registration.password,
        role: UserRole.MAHASISWA,
      },
    }),
    db.trn_registrations.delete({ where: { id: registration.id } }),
  ]);

  return {
    status: true,
    message: "Akun berhasil dibuat",
    data: createSession(user.id),
  };
};

export const SResendRegistrationCode = async (
  body: IResendRegistrationRequestBody
): Promise<IBaseResponse<IRegistrationResponseBody>> => {
  const email = readEmail(body?.email);

  const registration = email
    ? await db.trn_registrations.findUnique({ where: { email } })
    : null;

  if (!registration)
    throw new NotFoundError("Pendaftaran tidak ditemukan, silakan daftar ulang.");

  const wait = waitMessage(registration.sent_at);

  if (wait) throw new TooManyRequestsError(wait);

  const code = generateVerificationCode();

  await sendVerificationCode(email, registration.fullname, code);

  const now = Date.now();

  await db.trn_registrations.update({
    where: { id: registration.id },
    data: {
      code: hashVerificationCode(email, code),
      attempts: 0,
      sent_at: new Date(now),
      expires_at: new Date(now + CODE_TTL_MS),
    },
  });

  return {
    status: true,
    message: `Kode verifikasi baru dikirim ke ${email}`,
    data: {
      email,
      nim: registration.nim,
      expires_in: CODE_TTL_MS / 1000,
      resend_in: RESEND_COOLDOWN_MS / 1000,
    },
  };
};
