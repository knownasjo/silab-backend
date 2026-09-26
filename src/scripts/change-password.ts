import dotenv from "dotenv";
dotenv.config({ quiet: true });

import readline from "readline";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import db from "../prisma/client.prisma";
import { passwordChangeTime } from "../helper/jwt.helper";

const MIN_PASSWORD_LENGTH = 8;
const CANCELLED = "Dibatalkan, password tidak diganti.";

const pipedLines = process.stdin.isTTY
  ? null
  : readline
      .createInterface({ input: process.stdin, terminal: false })
      [Symbol.asyncIterator]();

const readPipedLine = async () => {
  const { value, done } = await pipedLines!.next();
  process.stdout.write("\n");
  return done ? null : String(value);
};

const ask = async (question: string) => {
  if (pipedLines) {
    process.stdout.write(question);
    return ((await readPipedLine()) ?? "").trim();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (
      await new Promise<string>((resolve) => {
        rl.once("close", () => resolve(""));
        rl.question(question, resolve);
      })
    ).trim();
  } finally {
    rl.close();
  }
};

const askHidden = async (question: string) => {
  if (pipedLines) {
    process.stdout.write(question);
    return readPipedLine();
  }

  const stdin = process.stdin;

  return new Promise<string | null>((resolve) => {
    let value = "";

    const finish = (result: string | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish(value);
        if (char === "\u0003" || char === "\u0004") return finish(null);

        if (char === "\u007f" || char === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        value += char;
        process.stdout.write("*");
      }
    };

    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
    process.stdout.write(question);
  });
};

const askNewPassword = async () => {
  const password = await askHidden("Password baru: ");

  if (password === null) {
    console.log(CANCELLED);
    return null;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.log(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter. ${CANCELLED}`
    );
    return null;
  }

  const repeated = await askHidden("Ulangi password baru: ");

  if (repeated === null) {
    console.log(CANCELLED);
    return null;
  }

  if (repeated !== password) {
    console.log(`Password tidak sama. ${CANCELLED}`);
    return null;
  }

  return password;
};

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

  const password = await askNewPassword();

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
      password_changed_at: passwordChangeTime(),
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
