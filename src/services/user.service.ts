import { Request } from "express";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  ICreateUserResponseBody,
  IGetUserResponseBody,
  IResetUserPasswordRequestBody,
  IResetUserPasswordResponseBody,
} from "../interfaces/user.interface";
import bcrypt from "bcryptjs";
import db from "../prisma/client.prisma";
import { UserRole } from "@prisma/client";
import { passwordChangeTime } from "../helper/jwt.helper";
import { closeUserStreams } from "../utils/RealtimeEvents/realtime.events";
import { assertNewPassword } from "../utils/PasswordRules/password.rules";
import { createAccount } from "../utils/AccountRules/account.rules";

export const SGetUser = async (
  req: Request,
  query: string | undefined
): Promise<IBaseResponse<IGetUserResponseBody[]>> => {
  try {
    const user = req.user;
    const role = req.path.split("/").join("").toUpperCase() as UserRole;
    const keyword = query?.trim();

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const userData = await db.mst_user.findMany({
      where: {
        role,
        ...(keyword && {
          OR: [
            { fullname: { contains: keyword, mode: "insensitive" } },
            { nim: { contains: keyword } },
          ],
        }),
      },
      orderBy: { fullname: "asc" },
      ...(role === "MAHASISWA" && { take: 20 }),
    });

    const data: IGetUserResponseBody[] = userData.map((data) => ({
      id: data.id,
      nim: data.nim,
      fullname: data.fullname,
    }));

    return {
      status: true,
      message: "Berhasil",
      data,
    };
  } catch (error) {
    throw error;
  }
};

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const SCreateUser = async (
  req: Request
): Promise<IBaseResponse<ICreateUserResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat membuat akun!");

  const user = await createAccount(req.body ?? {});

  return {
    status: true,
    message: "Akun berhasil dibuat",
    data: {
      id: user.id,
      email: user.email,
      nim: user.nim,
      fullname: user.fullname,
      role: user.role,
    },
  };
};

export const SResetUserPassword = async (
  req: Request
): Promise<IBaseResponse<IResetUserPasswordResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError(
      "Hanya laboran yang dapat mengganti password akun lain!"
    );

  const body: Partial<IResetUserPasswordRequestBody> = req.body ?? {};
  const account = readText(req.params.account);
  const password = typeof body.password === "string" ? body.password : "";

  assertNewPassword(password);

  const target = account
    ? await db.mst_user.findFirst({
        where: { OR: [{ id: account }, { nim: account }] },
        select: { id: true, nim: true, fullname: true, role: true },
      })
    : null;

  if (!target) throw new NotFoundError("Akun tidak ditemukan!");

  if (target.role !== UserRole.LABORAN && target.role !== UserRole.DOSEN)
    throw new ForbiddenError(
      "Password mahasiswa tidak bisa diganti laboran. Mahasiswa memakai Lupa password di aplikasi SILAB."
    );

  await db.mst_user.update({
    where: { id: target.id },
    data: {
      password: await bcrypt.hash(password, 10),
      passwordChangedAt: passwordChangeTime(),
    },
  });

  closeUserStreams(target.id);

  return {
    status: true,
    message: `Password ${target.fullname} berhasil diganti`,
    data: target,
  };
};
