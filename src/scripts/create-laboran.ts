import "./load-env";

import { UserRole } from "@prisma/client";
import db from "../prisma/client.prisma";
import { BaseError } from "../utils/BaseErrors/BaseErrors";
import {
  assertAccountFree,
  createAccount,
  readAccount,
} from "../utils/AccountRules/account.rules";
import { ask, askNewPassword } from "./terminal-input";

const CANCELLED = "Dibatalkan, akun tidak dibuat.";

const createLaboran = async () => {
  console.log("Membuat akun LABORAN baru.");

  const input = {
    nim: await ask("NIY (8 angka): "),
    fullname: await ask("Nama lengkap: "),
    email: await ask("Email: "),
    role: UserRole.LABORAN,
  };
  const account = readAccount(input);

  await assertAccountFree(account);

  const password = await askNewPassword(CANCELLED);

  if (password === null) return 1;

  if (
    (
      await ask(
        `Buat akun laboran ${account.fullname} (NIY ${account.nim}, ${account.email})? (ya/tidak): `
      )
    ).toLowerCase() !== "ya"
  ) {
    console.log(CANCELLED);
    return 1;
  }

  const user = await createAccount({ ...input, password });

  console.log(
    `Akun laboran ${user.fullname} berhasil dibuat. Login di web dengan NIY ${user.nim}.`
  );
  return 0;
};

createLaboran()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof BaseError)
      console.log(`${error.message} ${CANCELLED}`);
    else console.error("Gagal, akun tidak dibuat:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
