import { UserRole, mst_user } from "@prisma/client";
import {
  CreateRefreshToken,
  CreateToken,
  VerifyRefreshToken,
  isIssuedBeforePasswordChange,
  passwordChangeTime,
} from "../helper/jwt.helper";
import {
  IChangePasswordRequestBody,
  IForgotPasswordRequestBody,
  IPasswordResetCodeResponseBody,
  IRefreshTokenRequestBody,
  IRefreshTokenResponseBody,
  IRegistrationResponseBody,
  IResendRegistrationRequestBody,
  IResetPasswordRequestBody,
  IUpdateProfileRequestBody,
  IUserLoginRequestBody,
  IUserLoginResponseBody,
  IUserProfileResponseBody,
  IUserRegisterRequestBody,
  IVerifyRegistrationRequestBody,
} from "../interfaces/auth.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
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
import { closeUserStreams } from "../utils/RealtimeEvents/realtime.events";
import bcrypt from "bcryptjs";

const CAMPUS_EMAIL = /^[a-z]+(\d{10})@webmail\.uad\.ac\.id$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const readEmail = (value: unknown) => readText(value).toLowerCase();

const readPassword = (value: unknown) => (typeof value === "string" ? value : "");

const readFullname = (value: unknown) => {
  const fullname = readText(value).replace(/\s+/g, " ");

  if (fullname.length < 3 || fullname.length > 100)
    throw new BadRequestError("Nama lengkap harus 3 sampai 100 karakter!");

  return fullname;
};

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

const resetCodeKey = (userId: string) => `password-reset:${userId}`;

const conflictMessage = (registeredEmail: string, email: string) =>
  registeredEmail.toLowerCase() === email
    ? "Email sudah terdaftar, silakan login."
    : "NIM sudah terdaftar, silakan login.";

export const SUserLogin = async (
  body: IUserLoginRequestBody
): Promise<IBaseResponse<IUserLoginResponseBody>> => {
  try {
    const nim = readText(body?.nim);
    const password = readPassword(body?.password);

    if (!nim || !password)
      throw new BadRequestError("NIM/NIY dan password wajib diisi!");

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

      throw new UnauthorizedError("NIM/NIY atau password salah!");
    }

    const isPassSame = await bcrypt.compare(password, userData.password);

    if (!isPassSame) throw new UnauthorizedError("NIM/NIY atau password salah!");

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

  const token = VerifyRefreshToken(refreshToken);

  const user = token
    ? await db.mst_user.findUnique({
        where: { id: token.id },
        select: { id: true, password_changed_at: true },
      })
    : null;

  if (
    !user ||
    isIssuedBeforePasswordChange(token?.issuedAt, user.password_changed_at)
  )
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
  const password = readPassword(body?.password);
  const confirmPassword = readPassword(body?.confirmPassword);

  const nim = CAMPUS_EMAIL.exec(email)?.[1];

  if (!nim)
    throw new BadRequestError(
      "Gunakan email kampus dengan format namadepanNIM@webmail.uad.ac.id!"
    );

  const fullname = readFullname(body?.fullname);

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

export const SForgotPassword = async (
  body: IForgotPasswordRequestBody
): Promise<IBaseResponse<IPasswordResetCodeResponseBody>> => {
  const email = readEmail(body?.email);

  if (!EMAIL_FORMAT.test(email))
    throw new BadRequestError("Format email tidak valid!");

  const user = await db.mst_user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, fullname: true, role: true },
  });

  if (!user) {
    const registration = await db.trn_registrations.findUnique({
      where: { email },
    });

    if (registration)
      throw new UnverifiedAccountError(
        "Akun ini belum diverifikasi, silakan selesaikan pendaftaran.",
        { email: registration.email }
      );

    throw new NotFoundError("Email ini belum terdaftar di SILAB.");
  }

  if (user.role !== UserRole.MAHASISWA)
    throw new ForbiddenError(
      "Reset password akun laboran dan dosen dilakukan oleh laboran."
    );

  const previous = await db.trn_password_resets.findUnique({
    where: { userId: user.id },
  });
  const wait = previous && waitMessage(previous.sent_at);

  if (wait) throw new TooManyRequestsError(wait);

  const code = generateVerificationCode();
  const target = user.email.toLowerCase();

  await sendVerificationCode(target, user.fullname, code, "password-reset");

  const now = Date.now();
  const data = {
    code: hashVerificationCode(resetCodeKey(user.id), code),
    attempts: 0,
    sent_at: new Date(now),
    expires_at: new Date(now + CODE_TTL_MS),
  };

  await db.trn_password_resets.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  return {
    status: true,
    message: `Kode reset password dikirim ke ${target}`,
    data: {
      email: target,
      expires_in: CODE_TTL_MS / 1000,
      resend_in: RESEND_COOLDOWN_MS / 1000,
    },
  };
};

export const SResetPassword = async (
  body: IResetPasswordRequestBody
): Promise<IBaseResponse> => {
  const email = readEmail(body?.email);
  const code = readText(body?.code);
  const password = readPassword(body?.password);
  const confirmPassword = readPassword(body?.confirmPassword);

  if (!email || !/^\d{6}$/.test(code))
    throw new BadRequestError("Masukkan 6 angka kode verifikasi!");

  if (password.length < MIN_PASSWORD_LENGTH)
    throw new BadRequestError(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter!`
    );

  if (password !== confirmPassword)
    throw new BadRequestError("Konfirmasi password tidak sama!");

  const reset = await db.trn_password_resets.findFirst({
    where: { user: { email: { equals: email, mode: "insensitive" } } },
  });

  if (!reset)
    throw new NotFoundError(
      "Permintaan reset password tidak ditemukan, minta kode baru."
    );

  if (reset.expires_at.getTime() < Date.now())
    throw new BadRequestError("Kode sudah kedaluwarsa, minta kode baru.");

  const { count } = await db.trn_password_resets.updateMany({
    where: { id: reset.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });

  if (count === 0)
    throw new TooManyRequestsError(
      `Kode salah ${MAX_ATTEMPTS} kali, minta kode baru.`
    );

  if (!isSameVerificationCode(reset.code, resetCodeKey(reset.userId), code)) {
    const remaining = MAX_ATTEMPTS - reset.attempts - 1;

    throw new BadRequestError(
      remaining > 0
        ? `Kode salah. Sisa ${remaining} percobaan.`
        : `Kode salah ${MAX_ATTEMPTS} kali, minta kode baru.`
    );
  }

  await db.$transaction([
    db.mst_user.update({
      where: { id: reset.userId },
      data: {
        password: await bcrypt.hash(password, 10),
        password_changed_at: passwordChangeTime(),
      },
    }),
    db.trn_password_resets.deleteMany({ where: { id: reset.id } }),
  ]);

  closeUserStreams(reset.userId);

  return {
    status: true,
    message: "Password berhasil diubah, silakan masuk.",
  };
};

const profileOf = (user: mst_user): IUserProfileResponseBody => ({
  id: user.id,
  nim: user.nim,
  name: user.fullname,
  email: user.email,
  role: user.role,
});

export const SUpdateProfile = async (
  userId: string,
  body: IUpdateProfileRequestBody
): Promise<IBaseResponse<IUserProfileResponseBody>> => {
  const fullname = readFullname(body?.fullname);

  const user = await db.mst_user.update({
    where: { id: userId },
    data: { fullname },
  });

  return {
    status: true,
    message: "Nama berhasil diperbarui",
    data: profileOf(user),
  };
};

export const SChangePassword = async (
  userId: string,
  body: IChangePasswordRequestBody
): Promise<IBaseResponse<IUserLoginResponseBody>> => {
  const oldPassword = readPassword(body?.oldPassword);
  const password = readPassword(body?.password);
  const confirmPassword = readPassword(body?.confirmPassword);

  if (!oldPassword) throw new BadRequestError("Password lama wajib diisi!");

  if (password.length < MIN_PASSWORD_LENGTH)
    throw new BadRequestError(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter!`
    );

  if (password !== confirmPassword)
    throw new BadRequestError("Konfirmasi password tidak sama!");

  const user = await db.mst_user.findUnique({ where: { id: userId } });

  if (!user || !(await bcrypt.compare(oldPassword, user.password)))
    throw new BadRequestError("Password lama salah!");

  if (password === oldPassword)
    throw new BadRequestError(
      "Password baru harus berbeda dari password lama."
    );

  await db.$transaction([
    db.mst_user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(password, 10),
        password_changed_at: passwordChangeTime(),
      },
    }),
    db.trn_password_resets.deleteMany({ where: { userId: user.id } }),
  ]);

  closeUserStreams(user.id);

  return {
    status: true,
    message: "Password berhasil diganti",
    data: createSession(user.id),
  };
};
