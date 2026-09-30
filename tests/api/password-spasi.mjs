import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("26");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NO_SPACE = "Password tidak boleh mengandung spasi!";
const TOO_SHORT = "Password minimal 8 karakter!";
const SPACED = [
  ["spasi di tengah", "rahasia 123"],
  ["spasi di awal", " rahasia123"],
  ["spasi di akhir", "rahasia123 "],
  ["tab di tengah", "rahasia\t123"],
];

const runScript = (args, input) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(
      "npm",
      ["run", "--silent", "ganti-password", "--", ...args],
      { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] }
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });

const canLogin = async (user, password) =>
  (
    await call("POST", "/auth/login", {
      body: { nim: user.nim, password },
    })
  ).code === 200;

await runTest("Password baru tanpa spasi", data, async () => {
  const student = await data.student();
  const studentToken = (await login(student, data.password)).token;
  const laboranToken = (await login(data.laboran, data.password)).token;

  section("Daftar akun mahasiswa (POST /auth/register)");
  const email = `uji${data.nextNim()}@webmail.uad.ac.id`;
  for (const [label, password] of SPACED)
    expect(
      `${label} ditolak`,
      await call("POST", "/auth/register", {
        body: {
          fullname: "Mahasiswa Spasi",
          email,
          password,
          confirmPassword: password,
        },
      }),
      400,
      NO_SPACE
    );
  expect(
    "password pendek berspasi tetap mendapat pesan panjang minimal",
    await call("POST", "/auth/register", {
      body: {
        fullname: "Mahasiswa Spasi",
        email,
        password: "a b",
        confirmPassword: "a b",
      },
    }),
    400,
    TOO_SHORT
  );
  check(
    "  tidak ada pendaftaran yang tersimpan",
    (await db.trn_registrations.count({ where: { email } })) === 0
  );

  section("Lupa password (POST /auth/password/reset)");
  for (const [label, password] of SPACED)
    expect(
      `${label} ditolak`,
      await call("POST", "/auth/password/reset", {
        body: {
          email: student.email,
          code: "123456",
          password,
          confirmPassword: password,
        },
      }),
      400,
      NO_SPACE
    );

  section("Ganti password sendiri (PUT /auth/me/password)");
  for (const [label, password] of SPACED)
    expect(
      `${label} ditolak`,
      await call("PUT", "/auth/me/password", {
        token: studentToken,
        body: {
          oldPassword: data.password,
          password,
          confirmPassword: password,
        },
      }),
      400,
      NO_SPACE
    );
  check(
    "  password lama masih berlaku",
    await canLogin(student, data.password)
  );
  const fresh = "rahasiaBaru123";
  expect(
    "password tanpa spasi tetap diterima",
    await call("PUT", "/auth/me/password", {
      token: studentToken,
      body: {
        oldPassword: data.password,
        password: fresh,
        confirmPassword: fresh,
      },
    }),
    200,
    "Password berhasil diganti"
  );
  check("  bisa login dengan password baru", await canLogin(student, fresh));

  section("Laboran membuat akun (POST /user)");
  const newNim = data.nextNim();
  for (const [label, password] of SPACED)
    expect(
      `${label} ditolak`,
      await call("POST", "/user", {
        token: laboranToken,
        body: {
          email: `uji-${newNim}@example.test`,
          nim: newNim,
          fullname: "Mahasiswa Spasi",
          password,
          role: "MAHASISWA",
        },
      }),
      400,
      NO_SPACE
    );
  check(
    "  akun tidak dibuat",
    (await db.mst_user.count({ where: { nim: newNim } })) === 0
  );

  section("Laboran mengganti password dosen (PUT /user/:nim/password)");
  for (const [label, password] of SPACED)
    expect(
      `${label} ditolak`,
      await call("PUT", `/user/${data.lecturer.nim}/password`, {
        token: laboranToken,
        body: { password },
      }),
      400,
      NO_SPACE
    );
  check(
    "  password dosen tidak berubah",
    await canLogin(data.lecturer, data.password)
  );

  section("Skrip npm run ganti-password");
  const spaced = await runScript([data.lecturer.nim], "rahasia 123\n");
  check(
    "password berspasi dibatalkan",
    spaced.code === 1 &&
      spaced.output.includes(
        "Password tidak boleh mengandung spasi. Dibatalkan, password tidak diganti."
      ),
    spaced.output.trim()
  );
  check(
    "  password dosen tidak berubah",
    await canLogin(data.lecturer, data.password)
  );
  const plain = await runScript(
    [data.lecturer.nim],
    `${fresh}\n${fresh}\nya\n`
  );
  check(
    "password tanpa spasi tetap bisa diganti lewat skrip",
    plain.code === 0 && plain.output.includes("berhasil diganti"),
    plain.output.trim()
  );
  check(
    "  dosen bisa login dengan password baru",
    await canLogin(data.lecturer, fresh)
  );
});
