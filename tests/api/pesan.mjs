import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import { call, expect, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("12");
const DENIED = "Anda tidak memiliki akses!";

await runTest("Pesan balasan server berbahasa Indonesia", data, async () => {
  const subject = await data.subject("Uji Pesan");
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const announcement = await db.mst_announcement.create({
    data: {
      type: "BASIC",
      title: "Uji Pesan",
      body: "sementara",
      author: data.laboran.id,
    },
  });
  const student = await data.student();

  section("Login tiap peran");
  for (const [label, user] of [
    ["laboran", data.laboran],
    ["dosen", data.lecturer],
    ["mahasiswa", student],
  ]) {
    expect(
      `login ${label}: Login berhasil`,
      await call("POST", "/auth/login", {
        body: { nim: user.nim, password: data.password },
      }),
      200,
      "Login berhasil"
    );
  }
  const laboran = (await login(data.laboran, data.password)).token;
  const lecturer = (await login(data.lecturer, data.password)).token;
  const mahasiswa = (await login(student, data.password)).token;

  section("Data berhasil dimuat");
  for (const path of [
    "/auth/me",
    "/subject",
    `/subject/${subject.id}`,
    "/announcement",
    `/announcement/${announcement.id}`,
    "/user/dosen",
    "/user/mahasiswa",
    "/class",
    `/class/${cls.id}`,
  ]) {
    expect(
      `GET ${path.replace(/[0-9a-f-]{36}/, ":id")} (laboran): Berhasil`,
      await call("GET", path, { token: laboran }),
      200,
      "Berhasil"
    );
  }
  expect(
    "GET /class/registration (mahasiswa): Berhasil",
    await call("GET", "/class/registration", { token: mahasiswa }),
    200,
    "Berhasil"
  );

  section("Data tidak ditemukan");
  expect(
    "mata kuliah yang tidak ada",
    await call("GET", `/subject/${MISSING_ID}`, { token: laboran }),
    404,
    "Mata kuliah tidak ditemukan!"
  );
  expect(
    "pengumuman yang tidak ada",
    await call("GET", `/announcement/${MISSING_ID}`, { token: laboran }),
    404,
    "Pengumuman tidak ditemukan!"
  );
  expect(
    "alamat yang tidak dikenal",
    await call("GET", "/tidak-ada", { token: laboran }),
    404,
    "Alamat tidak ditemukan!"
  );

  section("Akses sesuai peran");
  expect(
    "mahasiswa membuka daftar dosen: ditolak",
    await call("GET", "/user/dosen", { token: mahasiswa }),
    401,
    DENIED
  );
  expect(
    "dosen membuka daftar mahasiswa: ditolak",
    await call("GET", "/user/mahasiswa", { token: lecturer }),
    401,
    DENIED
  );
  expect(
    "laboran membuka pilihan kelas mahasiswa: ditolak",
    await call("GET", "/class/registration", { token: laboran }),
    401,
    DENIED
  );
});
