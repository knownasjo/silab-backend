import { UserRole } from "@prisma/client";
import {
  CreateRefreshToken,
  CreateToken,
  VerifyRefreshToken,
} from "../helper/jwt.helper";
import {
  IRefreshTokenRequestBody,
  IRefreshTokenResponseBody,
  IUserLoginRequestBody,
  IUserLoginResponseBody,
  IUserRegisterRequestBody,
} from "../interfaces/auth.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import bcrypt from "bcryptjs";

export const SUserLogin = async (
  body: IUserLoginRequestBody
): Promise<IBaseResponse<IUserLoginResponseBody>> => {
  try {
    const { nim, password } = body;

    const userData = await db.mst_user.findFirst({
      where: {
        nim,
      },
    });

    if (!userData) throw new UnauthorizedError("NIM atau password salah!");

    const isPassSame = await bcrypt.compare(password, userData.password);

    if (!isPassSame) throw new UnauthorizedError("NIM atau password salah!");

    const accessToken = CreateToken({
      id: userData.id,
    });

    const refreshToken = CreateRefreshToken({ id: userData.id });

    return {
      status: true,
      message: "Login Successful",
      data: {
        accessToken: accessToken,
        refreshToken: refreshToken,
      },
    };
  } catch (error: any) {
    throw error;
  }
};

/**
 * Menukar refresh token (berlaku 1 hari sejak login) dengan access token baru
 * (15 menit), supaya web dan mobile tidak perlu login ulang setiap 15 menit.
 * Refresh token tidak diperpanjang, jadi sesi tetap berakhir 1 hari setelah
 * login.
 */
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
): Promise<IBaseResponse> => {
  try {
    const { email, password, confirmPassword, fullname, nim, role } = body;

    const isEmailExist = await db.mst_user.findFirst({
      where: {
        email,
      },
    });

    if (isEmailExist) throw new ConflictError("Email already registered!");

    if (password !== confirmPassword)
      throw new UnauthorizedError("Password don't match");

    const hashedPassword = await bcrypt.hash(password, 10);

    const defaultRole = UserRole.MAHASISWA;

    const newUser = await db.mst_user.create({
      data: {
        email,
        password: hashedPassword,
        fullname,
        nim,
        role: role ?? defaultRole,
      },
    });

    if (!newUser) throw new UnauthorizedError("User Registration error!");

    return {
      status: true,
      message: "User created",
    };
  } catch (error: any) {
    throw error;
  }
};
