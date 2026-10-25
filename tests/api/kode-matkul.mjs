import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("17");
const NAME = "Uji Kode Matkul";
const MUST_BE_9 = "Kode mata kuliah harus 9 angka!";

await runTest("Kode mata kuliah 9 angka", data, async () => {
  const existing = await data.subject("Uji Kode Lama");
  const cls = await data.classOf(existing, "A", "MONDAY", 1);
  const laboran = (await login(data.laboran, data.password)).token;
  const lecturer = (await login(data.lecturer, data.password)).token;
  const base = {
    subjectName: NAME,
    semester: "2",
    lecturerId: data.lecturer.id,
  };
  const add = (subjectCode) =>
    call("POST", "/subject", {
      token: laboran,
      body: { ...base, subjectCode },
    });
  const update = (id, body) =>
    call("PUT", `/subject/${id}`, { token: laboran, body });
  const countOwn = () =>
    db.mst_subject.count({ where: { createdBy: data.laboran.id } });

  section("Tambah mata kuliah");
  const before = await countOwn();
  for (const [label, code] of [
    ["8 angka", "12345678"],
    ["10 angka", "1234567890"],
    ["ada huruf", "12345678a"],
    ["ada spasi di tengah", "1234 56789"],
    ["huruf semua", "IF2203ABC"],
    ["angka desimal", "12345678.9"],
  ])
    expect(`kode ${label}: ditolak`, await add(code), 400, MUST_BE_9);
  expect(
    "kode kosong: ditolak",
    await add("  "),
    400,
    "Kode mata kuliah wajib diisi!"
  );
  expect(
    "kode yang sudah dipakai: ditolak dengan nama pemakainya",
    await add(existing.subjectCode),
    409,
    `Kode ${existing.subjectCode} sudah dipakai mata kuliah Uji Kode Lama!`
  );
  check(
    "  tidak ada mata kuliah yang tersimpan dari penolakan",
    (await countOwn()) === before
  );
  const code = data.nextCode();
  const created = await add(` ${code} `);
  expect(
    "9 angka dengan spasi di ujung: diterima",
    created,
    201,
    `Mata kuliah ${NAME} berhasil ditambahkan`
  );
  const id = created.json.data?.id;
  const stored = await db.mst_subject.findUnique({ where: { id } });
  check(
    "  kode tersimpan tanpa spasi",
    stored?.subjectCode === code,
    stored?.subjectCode
  );

  section("Ubah mata kuliah");
  expect(
    "kode 8 angka: ditolak",
    await update(id, { subjectCode: code.slice(1) }),
    400,
    MUST_BE_9
  );
  expect(
    "kode baru 9 angka: diterima",
    await update(id, { subjectCode: data.nextCode() }),
    200,
    `Mata kuliah ${NAME} berhasil diperbarui`
  );
  await db.mst_subject.update({
    where: { id },
    data: { subjectCode: "PM01" },
  });
  expect(
    "kode lama belum 9 angka: ubah nama saja ditolak",
    await update(id, { subjectName: `${NAME} Baru` }),
    400,
    MUST_BE_9
  );
  expect(
    "kode lama diganti 9 angka bersamaan dengan nama: diterima",
    await update(id, {
      subjectCode: data.nextCode(),
      subjectName: `${NAME} Baru`,
    }),
    200
  );

  section("Kode ikut tampil");
  const subjects =
    (await call("GET", "/subject", { token: laboran })).json.data ?? [];
  const odd = subjects.filter((s) => !/^\d{9}$/.test(s.subjectCode));
  check(
    "semua mata kuliah di database berkode 9 angka",
    subjects.length > 0 && odd.length === 0,
    JSON.stringify(odd.map((s) => `${s.subjectName}: ${s.subjectCode}`))
  );
  for (const [label, token] of [
    ["laboran", laboran],
    ["dosen", lecturer],
  ]) {
    const detail = await call("GET", `/class/${cls.id}`, { token });
    check(
      `detail kelas membawa kode mata kuliah (${label})`,
      detail.json.data?.subjectCode === existing.subjectCode,
      JSON.stringify(detail.json.data?.subjectCode)
    );
  }
});
