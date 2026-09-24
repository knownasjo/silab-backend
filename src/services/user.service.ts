import { Request } from "express";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  ICreateUserRequestBody,
  ICreateUserResponseBody,
  IGetUserResponseBody,
} from "../interfaces/user.interface";
import bcrypt from "bcryptjs";
import db from "../prisma/client.prisma";
import { UserRole } from "@prisma/client";

export const SGetUser = async (
  req: Request,
  query: string | undefined
): Promise<IBaseResponse<IGetUserResponseBody[]>> => {
  try {
    const user = req.user;
    const role = req.path;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed!");

    const userData = await db.mst_user.findMany({
      where: {
        fullname: {
          contains: query,
        },
        role: role.split("/").join("").toUpperCase() as UserRole,
      },
    });

    const data: IGetUserResponseBody[] = userData.map((data) => ({
      id: data.id,
      nim: data.nim,
      fullname: data.fullname,
    }));

    return {
      status: true,
      message: "Success",
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
  const roles = Object.values(UserRole) as string[];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestError("Format email tidak valid!");

  if (!/^\d{1,30}$/.test(nim))
    throw new BadRequestError("NIM hanya boleh berisi angka!");

  if (fullname.length < 3 || fullname.length > 100)
    throw new BadRequestError("Nama lengkap harus 3 sampai 100 karakter!");

  if (password.length < 8)
    throw new BadRequestError("Password minimal 8 karakter!");

  if (!roles.includes(role))
    throw new BadRequestError(`Role harus salah satu dari ${roles.join(", ")}!`);

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
        : "NIM sudah terdaftar!"
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
