import { UserRole } from "@prisma/client";
import { CreateRefreshToken, CreateToken } from "../helper/jwt.helper";
import {
  IUserLoginRequestBody,
  IUserLoginResponseBody,
  IUserRegisterRequestBody,
} from "../interfaces/auth.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
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

    if (!userData) throw new UnauthorizedError("Email or password invalid!");

    const isPassSame = await bcrypt.compare(password, userData.password);

    if (!isPassSame) throw new UnauthorizedError("Email or password invalid!");

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
