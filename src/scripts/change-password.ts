import "./load-env";

import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import db from "../prisma/client.prisma";
import { passwordChangeTime } from "../helper/jwt.helper";
import { ask, askNewPassword } from "./terminal-input";

const CANCELLED = "Dibatalkan, password tidak diganti.";

const changePassword = async (nim: string) => {
  const user = await db.mst_user.findUnique({
    where: { nim },
    select: { id: true, nim: true, fullname: true, role: true },
  });

  if (!user) {
    console.log(`Tidak ada akun dengan NIM/NIY ${nim}.`);
    return 1;
  }

  console.log(`Akun: ${user.fullname} (${user.role}, ${user.nim})`);

  const isStudent = user.role === UserRole.MAHASISWA;

  if (isStudent) {
    console.log("ALERT: mahasiswa biasanya memakai Lupa password lewat email.");
    console.log(
      "Pakai skrip ini kalau mahasiswa tidak bisa mengakses email kampusnya."
    );

    if ((await ask("Ketik ulang NIM untuk melanjutkan: ")) !== user.nim) {
      console.log(`NIM tidak sama. ${CANCELLED}`);
      return 1;
    }
  }

  const password = await askNewPassword(CANCELLED);

  if (password === null) return 1;

  if (
    !isStudent &&
    (await ask("Ganti password akun ini? (ya/tidak): ")).toLowerCase() !== "ya"
  ) {
    console.log(CANCELLED);
    return 1;
  }

  await db.mst_user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(password, 10),
      passwordChangedAt: passwordChangeTime(),
    },
  });

  console.log(
    `Password ${user.fullname} berhasil diganti. Semua sesi login akun ini diakhiri.`
  );
  return 0;
};

const main = async () => {
  const nim = (process.argv[2] ?? "").trim();

  if (!nim) {
    console.log("Cara pakai: npm run ganti-password <NIM/NIY>");
    return 1;
  }

  return changePassword(nim);
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Gagal, password tidak diganti:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
