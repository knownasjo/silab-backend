import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import db from "../../prisma/client.prisma";
import { ICreateUserRequestBody } from "../../interfaces/user.interface";
import { BadRequestError, ConflictError } from "../HttpErrors/HttptErrors";
import { assertNewPassword } from "../PasswordRules/password.rules";

const ROLES: string[] = [UserRole.MAHASISWA, UserRole.LABORAN, UserRole.DOSEN];

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const readAccount = (body: Partial<ICreateUserRequestBody>) => {
  const email = readText(body.email).toLowerCase();
  const nim = readText(body.nim);
  const fullname = readText(body.fullname).replace(/\s+/g, " ");
  const role = readText(body.role).toUpperCase();
  const isStaff = role === UserRole.LABORAN || role === UserRole.DOSEN;

  if (!ROLES.includes(role))
    throw new BadRequestError(
      `Role harus salah satu dari ${ROLES.join(", ")}!`
    );

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestError("Format email tidak valid!");

  if (isStaff && !/^\d{8}$/.test(nim))
    throw new BadRequestError("NIY harus 8 angka!");

  if (!isStaff && !/^\d{1,30}$/.test(nim))
    throw new BadRequestError("NIM hanya boleh berisi angka!");

  if (fullname.length < 3 || fullname.length > 100)
    throw new BadRequestError("Nama lengkap harus 3 sampai 100 karakter!");

  return { email, nim, fullname, role: role as UserRole, isStaff };
};

export const assertAccountFree = async ({
  email,
  nim,
  isStaff,
}: {
  email: string;
  nim: string;
  isStaff: boolean;
}) => {
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
};

export const createAccount = async (body: Partial<ICreateUserRequestBody>) => {
  const account = readAccount(body);
  const password = typeof body.password === "string" ? body.password : "";

  assertNewPassword(password);
  await assertAccountFree(account);

  const { email, nim, fullname, role } = account;
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
        role,
      },
    }),
  ]);

  return user;
};
