import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("37");
const CREATED = "Akun berhasil dibuat";
const PASSWORD = "stafbaru123";

const createUser = (token, body) =>
  call("POST", "/user", { token, body: { password: PASSWORD, ...body } });

const hasNullEmail = (res) =>
  Object.hasOwn(res.json.data ?? {}, "email") && res.json.data.email === null;

const shown = (user) =>
  JSON.stringify(user && { ...user, password: undefined });

await runTest("Akun laboran dan dosen tanpa email", data, async () => {
  const niy = (n) => `${data.nimPrefix}${n}`;
  const account = (nim) => db.mst_user.findUnique({ where: { nim } });
  const laboranToken = (await login(data.laboran, data.password)).token;
  const student = await data.student("Mahasiswa Email Staf");

  section("Laboran membuat akun dosen dan laboran tanpa email (POST /user)");
  const lecturerRes = await createUser(laboranToken, {
    nim: niy(1),
    fullname: "Dosen Tanpa Email",
    role: "DOSEN",
  });
  expect("akun dosen tanpa email dibuat", lecturerRes, 201, CREATED);
  check(
    "  balasan berisi email: null",
    hasNullEmail(lecturerRes),
    JSON.stringify(lecturerRes.json.data)
  );
  expect(
    "akun laboran tanpa email dibuat",
    await createUser(laboranToken, {
      nim: niy(2),
      fullname: "Laboran Tanpa Email",
      role: "LABORAN",
    }),
    201,
    CREATED
  );
  const [lecturer, laboran] = await Promise.all([
    account(niy(1)),
    account(niy(2)),
  ]);
  const withoutEmail = await db.mst_user.count({
    where: { nim: { startsWith: data.nimPrefix }, email: null },
  });
  check(
    "  keduanya tersimpan tanpa email, bersama laboran dan dosen uji (4 akun)",
    lecturer?.role === "DOSEN" &&
      lecturer.email === null &&
      laboran?.role === "LABORAN" &&
      laboran.email === null &&
      withoutEmail === 4,
    `${shown(lecturer)} ${shown(laboran)} tanpa email: ${withoutEmail}`
  );
  check(
    "  dosen baru langsung bisa login",
    (
      await call("POST", "/auth/login", {
        body: { nim: niy(1), password: PASSWORD },
      })
    ).code === 200
  );

  section("Email yang tetap dikirim untuk akun staf diabaikan");
  const ignoredEmail = `uji-${niy(3)}@example.test`;
  for (const [label, n, role, email] of [
    ["email biasa", 3, "DOSEN", ignoredEmail.toUpperCase()],
    ["email berformat salah", 4, "LABORAN", "bukan-email"],
    ["email yang sudah dipakai mahasiswa", 5, "DOSEN", student.email],
  ]) {
    const res = await createUser(laboranToken, {
      email,
      nim: niy(n),
      fullname: `Staf Email ${n}`,
      role,
    });
    const saved = await account(niy(n));
    check(
      `${label}: akun dibuat, email tidak disimpan`,
      res.code === 201 && hasNullEmail(res) && saved?.email === null,
      `${res.code} ${res.message} ${shown(saved)}`
    );
  }
  check(
    "  email mahasiswa itu tetap miliknya",
    (await account(student.nim))?.email === student.email
  );

  section("NIY ganda tetap ditolak");
  expect(
    "NIY dosen yang sudah terdaftar",
    await createUser(laboranToken, {
      nim: niy(1),
      fullname: "Dosen Ganda",
      role: "DOSEN",
    }),
    409,
    "NIY sudah terdaftar!"
  );
  expect(
    "NIY yang sama, kali ini dengan email",
    await createUser(laboranToken, {
      email: `uji-ganda-${niy(1)}@example.test`,
      nim: niy(1),
      fullname: "Laboran Ganda",
      role: "LABORAN",
    }),
    409,
    "NIY sudah terdaftar!"
  );

  section("Akun mahasiswa tetap wajib email");
  const newNim = data.nextNim();
  const newEmail = `uji-${newNim}@example.test`;
  expect(
    "mahasiswa tanpa email ditolak",
    await createUser(laboranToken, {
      nim: newNim,
      fullname: "Mahasiswa Baru",
      role: "MAHASISWA",
    }),
    400,
    "Format email tidak valid!"
  );
  expect(
    "email yang sudah dipakai mahasiswa lain ditolak",
    await createUser(laboranToken, {
      email: student.email.toUpperCase(),
      nim: newNim,
      fullname: "Mahasiswa Baru",
      role: "MAHASISWA",
    }),
    409,
    "Email sudah terdaftar!"
  );
  expect(
    "NIM yang sama dengan NIY dosen tanpa email ditolak",
    await createUser(laboranToken, {
      email: newEmail,
      nim: niy(1),
      fullname: "Mahasiswa Baru",
      role: "MAHASISWA",
    }),
    409,
    "NIM sudah terdaftar!"
  );
  const studentRes = await createUser(laboranToken, {
    email: newEmail.toUpperCase(),
    nim: newNim,
    fullname: "Mahasiswa Baru",
    role: "MAHASISWA",
  });
  expect("mahasiswa dengan email dibuat", studentRes, 201, CREATED);
  check(
    "  email mahasiswa tersimpan dan dikirim balik dalam huruf kecil",
    studentRes.json.data?.email === newEmail &&
      (await account(newNim))?.email === newEmail,
    JSON.stringify(studentRes.json.data)
  );

  section("Data akun sendiri (GET dan PUT /auth/me)");
  const lecturerToken = (await login(niy(1), PASSWORD)).token;
  for (const [label, token, email] of [
    ["dosen", lecturerToken, null],
    ["laboran", laboranToken, null],
    ["mahasiswa", (await login(student, data.password)).token, student.email],
  ]) {
    const me = await call("GET", "/auth/me", { token });
    check(
      `GET /auth/me ${label}: email ${email === null ? "null" : "tetap ada"}`,
      me.code === 200 &&
        Object.hasOwn(me.json.data ?? {}, "email") &&
        me.json.data.email === email,
      `${me.code} ${JSON.stringify(me.json.data)}`
    );
  }
  const renamed = await call("PUT", "/auth/me", {
    token: lecturerToken,
    body: { fullname: "Dosen Tanpa Email Baru" },
  });
  check(
    "PUT /auth/me dosen: nama berubah, balasan berisi email: null",
    renamed.code === 200 &&
      renamed.json.data?.name === "Dosen Tanpa Email Baru" &&
      hasNullEmail(renamed),
    `${renamed.code} ${JSON.stringify(renamed.json.data)}`
  );

  section("Lupa password dan pendaftaran");
  expect(
    "email yang diabaikan tidak bisa dipakai Lupa password",
    await call("POST", "/auth/password/forgot", {
      body: { email: ignoredEmail },
    }),
    404,
    "Email ini belum terdaftar di SILAB."
  );
  check(
    "  tidak ada kode reset yang dibuat",
    (await db.trn_password_resets.count({
      where: { user: { nim: { startsWith: data.nimPrefix } } },
    })) === 0
  );
  expect(
    "daftar dengan NIM milik dosen tanpa email ditolak (bukan error server)",
    await call("POST", "/auth/register", {
      body: {
        fullname: "Calon Mahasiswa",
        email: `uji${data.lecturer.nim}@webmail.uad.ac.id`,
        password: "calonmhs123",
        confirmPassword: "calonmhs123",
      },
    }),
    409,
    "NIM sudah terdaftar, silakan login."
  );
  check(
    "  tidak ada pendaftaran yang tersimpan",
    (await db.trn_registrations.count({
      where: { nim: data.lecturer.nim },
    })) === 0
  );
});
