import { Request } from "express";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  ICreateUserRequestBody,
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

  const body: Partial<ICreateUserRequestBody> = req.body ?? {};
  const email = readText(body.email).toLowerCase();
  const nim = readText(body.nim);
  const fullname = readText(body.fullname).replace(/\s+/g, " ");
  const password = typeof body.password === "string" ? body.password : "";
  const role = readText(body.role).toUpperCase();
  const roles: string[] = [UserRole.MAHASISWA, UserRole.LABORAN, UserRole.DOSEN];
  const isStaff = role === UserRole.LABORAN || role === UserRole.DOSEN;

  if (!roles.includes(role))
    throw new BadRequestError(`Role harus salah satu dari ${roles.join(", ")}!`);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestError("Format email tidak valid!");

  if (isStaff && !/^\d{8}$/.test(nim))
    throw new BadRequestError("NIY harus 8 angka!");

  if (!isStaff && !/^\d{1,30}$/.test(nim))
    throw new BadRequestError("NIM hanya boleh berisi angka!");

  if (fullname.length < 3 || fullname.length > 100)
    throw new BadRequestError("Nama lengkap harus 3 sampai 100 karakter!");

  if (password.length < 8)
    throw new BadRequestError("Password minimal 8 karakter!");

  const registeredUser = await db.mst_user.findFirst({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { nim }],
    },
    select: { email: true },
  });

  if (registeredUser)
    throw new ConflictError(
      registeredUser.email.toLowerCase() === email
        ? "Email sudah terdaftar!"
        : `${isStaff ? "NIY" : "NIM"} sudah terdaftar!`
    );

  const [, user] = await db.$transaction([
    db.trn_registrations.deleteMany({
      where: { OR: [{ email }, { nim }] },
    }),
    db.mst_user.create({
      data: {
        email,
        nim,
        fullname,
        password: await bcrypt.hash(password, 10),
        role: role as UserRole,
      },
    }),
  ]);

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

  if (password.length < 8)
    throw new BadRequestError("Password minimal 8 karakter!");

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
      password_changed_at: passwordChangeTime(),
    },
  });

  closeUserStreams(target.id);

  return {
    status: true,
    message: `Password ${target.fullname} berhasil diganti`,
    data: target,
  };
};
