import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("25");
const PREFIX = "Uji PM";
const REGISTRATION_ONLY =
  "Pengumuman pendaftaran selalu untuk semua mahasiswa!";

await runTest("Pengumuman untuk mata kuliah tertentu", data, async () => {
  const laboran = (await login(data.laboran, data.password)).token;
  const dosen = (await login(data.lecturer, data.password)).token;
  const X = await data.subject("Uji PM Algoritma");
  const Y = await data.subject("Uji PM Basis Data");
  const XA = await data.classOf(X, "A", "MONDAY", 1);
  const newStudent = async (name) => {
    const user = await data.student(name);
    return { ...user, token: (await login(user, data.password)).token };
  };
  const unpaidX = await newStudent("Uji PM Belum Bayar X");
  const paidX = await newStudent("Uji PM Lunas X");
  const onlyY = await newStudent("Uji PM Hanya Y");
  const assistantX = await newStudent("Uji PM Asisten X");
  const nobody = await newStudent("Uji PM Tanpa Mata Kuliah");
  await data.activate(unpaidX, X, false);
  await data.activate(paidX, X, true);
  await data.enroll(paidX, XA);
  await data.activate(onlyY, Y, true);
  await db.trn_class_collaborator.create({
    data: { userId: assistantX.id, classId: XA.id },
  });

  const post = (body) =>
    call("POST", "/announcement", { token: laboran, body });
  const put = (announcement, body) =>
    call("PUT", `/announcement/${announcement.id}`, { token: laboran, body });
  const byTitle = (title) =>
    db.mst_announcement.findFirst({
      where: { title },
      include: { subjects: true },
    });
  const titlesFor = async (token) => {
    const res = await call("GET", "/announcement", { token });
    return (res.json.data ?? [])
      .map((a) => a.title)
      .filter((title) => title.startsWith(PREFIX))
      .sort();
  };
  const sees = async (student, expected) => {
    const titles = await titlesFor(student.token);
    return {
      ok: JSON.stringify(titles) === JSON.stringify([...expected].sort()),
      detail: JSON.stringify(titles),
    };
  };
  const announce = (title, extra = {}) =>
    post({ type: "BASIC", title, body: "Isi pengumuman uji.", ...extra });

  section("Membuat pengumuman");
  expect("untuk semua mahasiswa", await announce("Uji PM Umum"), 201);
  expect(
    "untuk mata kuliah X",
    await announce("Uji PM Untuk X", { subjectIds: [X.id] }),
    201
  );
  expect(
    "untuk mata kuliah X dan Y",
    await announce("Uji PM Untuk X dan Y", { subjectIds: [X.id, Y.id] }),
    201
  );
  expect(
    "daftar mata kuliah kosong berarti untuk semua",
    await announce("Uji PM Daftar Kosong", { subjectIds: [] }),
    201
  );
  const forX = await byTitle("Uji PM Untuk X");
  const emptyList = await byTitle("Uji PM Daftar Kosong");
  check(
    "  pengumuman mata kuliah tercatat dengan semester aktif",
    forX.for_all === false &&
      forX.periodId === data.period.id &&
      forX.subjects.length === 1 &&
      forX.subjects[0].subjectId === X.id,
    JSON.stringify(forX)
  );
  check(
    "  daftar kosong tersimpan untuk semua, tanpa semester",
    emptyList.for_all === true &&
      emptyList.periodId === null &&
      emptyList.subjects.length === 0
  );
  for (const type of ["PRACTICUM", "INHALL", "ASSISTANT"])
    expect(
      `jenis ${type} dengan mata kuliah: ditolak`,
      await post({
        type,
        title: "Uji PM Pendaftaran",
        body: "Isi.",
        subjectIds: [X.id],
      }),
      400,
      REGISTRATION_ONLY
    );
  for (const [label, subjectIds] of [
    ["teks", "abc"],
    ["isi kosong", [""]],
    ["angka", [123]],
  ])
    expect(
      `mata kuliah tujuan berupa ${label}: ditolak`,
      await announce("Uji PM Salah", { subjectIds }),
      400,
      "Mata kuliah tujuan tidak valid!"
    );
  expect(
    "mata kuliah tujuan yang tidak ada: ditolak",
    await announce("Uji PM Salah", { subjectIds: [MISSING_ID] }),
    404,
    "Mata kuliah tidak ditemukan!"
  );
  check(
    "  pengumuman yang ditolak tidak tersimpan",
    (await db.mst_announcement.count({
      where: { title: { in: ["Uji PM Salah", "Uji PM Pendaftaran"] } },
    })) === 0
  );

  const oldPeriod = await db.mst_academic_period.create({
    data: { year: "1919/1920", term: "GANJIL", created_by: data.laboran.id },
  });
  const oldForX = await db.mst_announcement.create({
    data: {
      type: "BASIC",
      title: "Uji PM Semester Lalu Untuk X",
      body: "Pengumuman semester lalu.",
      author: data.laboran.id,
      for_all: false,
      periodId: oldPeriod.id,
      subjects: { create: [{ subjectId: X.id }] },
    },
  });

  section("Siapa yang melihat");
  const ALL = ["Uji PM Umum", "Uji PM Daftar Kosong"];
  for (const [label, student, expected] of [
    ["mahasiswa tanpa mata kuliah", nobody, ALL],
    [
      "mahasiswa X yang belum bayar",
      unpaidX,
      [...ALL, "Uji PM Untuk X", "Uji PM Untuk X dan Y"],
    ],
    [
      "mahasiswa X yang sudah lunas",
      paidX,
      [...ALL, "Uji PM Untuk X", "Uji PM Untuk X dan Y"],
    ],
    ["mahasiswa Y", onlyY, [...ALL, "Uji PM Untuk X dan Y"]],
    [
      "asisten kelas X (tidak mendaftar)",
      assistantX,
      [...ALL, "Uji PM Untuk X", "Uji PM Untuk X dan Y"],
    ],
  ]) {
    const result = await sees(student, expected);
    check(label, result.ok, result.detail);
  }
  check(
    "  pengumuman mata kuliah semester lalu tidak tampil untuk mahasiswa X sekarang",
    !(await titlesFor(unpaidX.token)).includes("Uji PM Semester Lalu Untuk X")
  );
  const staffTitles = [
    ...ALL,
    "Uji PM Untuk X",
    "Uji PM Untuk X dan Y",
    "Uji PM Semester Lalu Untuk X",
  ].sort();
  check(
    "laboran melihat semua",
    JSON.stringify(await titlesFor(laboran)) === JSON.stringify(staffTitles),
    JSON.stringify(await titlesFor(laboran))
  );
  check(
    "dosen melihat semua",
    JSON.stringify(await titlesFor(dosen)) === JSON.stringify(staffTitles)
  );
  const detail = await call("GET", `/announcement/${oldForX.id}`, {
    token: laboran,
  });
  check(
    "  detail menyebut tujuan dan semesternya",
    detail.code === 200 &&
      detail.json.data.for_all === false &&
      detail.json.data.period === "1919/1920 Ganjil" &&
      JSON.stringify(detail.json.data.subjects.map((s) => s.subject_name)) ===
        JSON.stringify(["Uji PM Algoritma"]),
    JSON.stringify(detail.json.data)
  );
  const umum = await byTitle("Uji PM Umum");
  const general = await call("GET", `/announcement/${umum.id}`, {
    token: laboran,
  });
  check(
    "  pengumuman untuk semua: for_all true, tanpa mata kuliah dan semester",
    general.json.data?.for_all === true &&
      general.json.data.subjects.length === 0 &&
      general.json.data.period === null,
    JSON.stringify(general.json.data)
  );
  expect(
    "mahasiswa lain membuka pengumuman X lewat alamat langsung: tidak ditemukan",
    await call("GET", `/announcement/${forX.id}`, { token: nobody.token }),
    404,
    "Pengumuman tidak ditemukan!"
  );
  expect(
    "  mahasiswa X membukanya: berhasil",
    await call("GET", `/announcement/${forX.id}`, { token: unpaidX.token }),
    200
  );

  section("Pendaftaran berubah");
  expect(
    "mahasiswa tanpa mata kuliah mendaftar X",
    await call("POST", "/activation", {
      token: nobody.token,
      body: { subjectIds: [X.id] },
    }),
    201
  );
  let result = await sees(nobody, [
    ...ALL,
    "Uji PM Untuk X",
    "Uji PM Untuk X dan Y",
  ]);
  check("  pengumuman X langsung tampil", result.ok, result.detail);
  const activation = await db.trn_activations.findFirst({
    where: { userId: nobody.id, subjectId: X.id },
  });
  expect(
    "  membatalkan pendaftaran X",
    await call("DELETE", `/activation/${activation.id}`, {
      token: nobody.token,
    }),
    200
  );
  result = await sees(nobody, ALL);
  check("  pengumuman X hilang lagi", result.ok, result.detail);

  section("Mengubah tujuan");
  expect(
    "pengumuman X diubah menjadi untuk semua",
    await put(forX, {
      type: "BASIC",
      title: "Uji PM Untuk X",
      body: "Isi.",
      subjectIds: [],
    }),
    200
  );
  result = await sees(nobody, [...ALL, "Uji PM Untuk X"]);
  check(
    "  kini tampil untuk mahasiswa tanpa mata kuliah",
    result.ok,
    result.detail
  );
  check(
    "  tersimpan untuk semua tanpa semester",
    (await byTitle("Uji PM Untuk X")).for_all === true &&
      (await byTitle("Uji PM Untuk X")).periodId === null
  );
  expect(
    "pengumuman umum diubah menjadi untuk Y",
    await put(umum, {
      type: "BASIC",
      title: "Uji PM Umum",
      body: "Isi.",
      subjectIds: [Y.id],
    }),
    200
  );
  result = await sees(unpaidX, [
    "Uji PM Daftar Kosong",
    "Uji PM Untuk X",
    "Uji PM Untuk X dan Y",
  ]);
  check("  mahasiswa X tidak melihatnya lagi", result.ok, result.detail);
  check(
    "  tersimpan untuk Y di semester aktif",
    (await byTitle("Uji PM Umum")).periodId === data.period.id
  );
  const forXY = await byTitle("Uji PM Untuk X dan Y");
  expect(
    "jenis diubah ke Pendaftaran sambil tetap memilih mata kuliah: ditolak",
    await put(forXY, {
      type: "PRACTICUM",
      title: "Uji PM Untuk X dan Y",
      body: "Isi.",
      subjectIds: [X.id],
    }),
    400,
    REGISTRATION_ONLY
  );
  expect(
    "jenis diubah ke Pendaftaran tanpa mengirim mata kuliah",
    await put(forXY, {
      type: "PRACTICUM",
      title: "Uji PM Untuk X dan Y",
      body: "Isi.",
    }),
    200
  );
  const becameAll = await byTitle("Uji PM Untuk X dan Y");
  check(
    "  otomatis untuk semua mahasiswa",
    becameAll.for_all === true && becameAll.subjects.length === 0
  );
  expect(
    "hanya teks pengumuman semester lalu yang diubah",
    await put(oldForX, {
      type: "BASIC",
      title: "Uji PM Semester Lalu Untuk X",
      body: "Isi baru.",
    }),
    200
  );
  const stillOld = await byTitle("Uji PM Semester Lalu Untuk X");
  check(
    "  tujuan dan semesternya tetap, jadi tetap tidak tampil untuk mahasiswa X",
    stillOld.periodId === oldPeriod.id &&
      stillOld.subjects.length === 1 &&
      !(await titlesFor(unpaidX.token)).includes("Uji PM Semester Lalu Untuk X")
  );

  section("Hapus mata kuliah yang dipakai pengumuman");
  const Z = await data.subject("Uji PM Hanya Pengumuman");
  await announce("Uji PM Untuk Z", { subjectIds: [Z.id] });
  expect(
    "mata kuliah yang hanya dipakai pengumuman: ditolak",
    await call("DELETE", `/subject/${Z.id}`, { token: laboran }),
    409,
    "Uji PM Hanya Pengumuman sudah punya 1 pengumuman, jadi tidak bisa dihapus."
  );
  const forZ = await byTitle("Uji PM Untuk Z");
  expect(
    "  pengumumannya dihapus dulu",
    await call("DELETE", `/announcement/${forZ.id}`, { token: laboran }),
    200
  );
  expect(
    "  lalu mata kuliahnya bisa dihapus",
    await call("DELETE", `/subject/${Z.id}`, { token: laboran }),
    200
  );
  expect(
    "mata kuliah dengan kelas, pendaftaran, dan pengumuman: ketiganya disebut",
    await call("DELETE", `/subject/${X.id}`, { token: laboran }),
    409,
    "Uji PM Algoritma sudah punya 1 kelas, 2 pendaftaran, dan 1 pengumuman, jadi tidak bisa dihapus."
  );
});
