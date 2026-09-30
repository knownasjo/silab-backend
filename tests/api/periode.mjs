import { db, TestData, TEST_CODE_PREFIX } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("20");
const TERMS = { GANJIL: "Ganjil", GENAP: "Genap" };
const label = (period) => `${period.year} ${TERMS[period.term]}`;
const nextOf = (period) => {
  if (period.term === "GANJIL") return { year: period.year, term: "GENAP" };
  const start = Number(period.year.split("/")[1]);
  return { year: `${start}/${start + 1}`, term: "GANJIL" };
};

await runTest("Periode akademik dan pergantian semester", data, async () => {
  const realOpenMeetings = await db.trn_meetings.count({
    where: {
      status: true,
      deleted_at: null,
      class: {
        subject: { subject_code: { not: { startsWith: TEST_CODE_PREFIX } } },
      },
    },
  });
  if (
    !check(
      "tidak ada sesi presensi asli yang sedang terbuka",
      realOpenMeetings === 0,
      `${realOpenMeetings} sesi terbuka; tes ini akan menutupnya saat mengganti semester, jadi tutup dulu sesinya lalu ulangi`
    )
  )
    return;

  const old = data.period;
  const oldName = label(old);
  const nextName = label(nextOf(old));
  const READ_ONLY = `Periode ${oldName} sudah selesai, data hanya bisa dilihat.`;

  const subject = await data.subject("Uji Periode");
  const sessions = await data.sessions();
  const oldClass = await data.classOf(subject, "A", "MONDAY", 1);
  const [repeater, senior, oldAssistant] = await Promise.all([
    data.student("Uji Mengulang"),
    data.student("Uji Senior"),
    data.student("Uji Asisten Lama"),
  ]);
  const repeaterOld = await data.activate(repeater, subject, true);
  await data.activate(senior, subject, true);
  await data.enroll(repeater, oldClass);
  await data.enroll(senior, oldClass);
  await db.trn_class_collaborator.create({
    data: { userId: oldAssistant.id, classId: oldClass.id },
  });
  const meeting = await data.meeting(oldClass, "Pertemuan 1", {
    status: true,
  });
  await data.attend(meeting, repeater, true);

  const laboran = (await login(data.laboran, data.password)).token;
  const mahasiswa = (await login(repeater, data.password)).token;
  const as = (token, body) => ({ token, body });

  section("Sebelum semester baru");
  const before = await call("GET", "/period", { token: laboran });
  check(
    `periode aktif ${oldName}`,
    before.json.data?.[0]?.name === oldName && before.json.data[0].is_active,
    JSON.stringify(before.json.data?.[0])
  );
  expect(
    "mahasiswa memulai semester baru: ditolak",
    await call("POST", "/period", { token: mahasiswa }),
    403,
    "Hanya laboran yang dapat memulai semester baru!"
  );

  section("Mulai semester baru");
  const started = await call("POST", "/period", { token: laboran });
  expect(
    `laboran memulai ${nextName}`,
    started,
    201,
    `Semester ${nextName} dimulai; 1 sesi presensi yang masih terbuka di ${oldName} ditutup`
  );
  const periods = (await call("GET", "/period", { token: laboran })).json.data;
  check(
    `  ${nextName} kini aktif, ${oldName} selesai`,
    periods?.[0]?.name === nextName &&
      periods[0].is_active &&
      periods[1]?.name === oldName &&
      !periods[1].is_active,
    JSON.stringify(periods?.slice(0, 2))
  );
  check(
    "  sesi presensi yang masih terbuka ditutup otomatis",
    (await db.trn_meetings.findUnique({ where: { id: meeting.id } })).status ===
      false
  );
  const newPeriodId = started.json.data?.id;

  section("Periode lama hanya bisa dilihat");
  for (const [labelText, method, path, body] of [
    ["ubah kelas", "PUT", `/class/${oldClass.id}`, { quota: 31 }],
    ["hapus kelas", "DELETE", `/class/${oldClass.id}`],
    [
      "tambah pertemuan",
      "POST",
      "/meeting",
      { classId: oldClass.id, meetingName: "Pertemuan 2" },
    ],
    [
      "buka sesi presensi",
      "PUT",
      `/meeting/${meeting.id}/status`,
      { status: true },
    ],
    [
      "ubah presensi",
      "PUT",
      `/meeting/${meeting.id}/attendances/${repeater.id}`,
      { status: false },
    ],
    [
      "cek HP tidak biasa",
      "PUT",
      `/meeting/${meeting.id}/attendances/${repeater.id}/device`,
      { present: true },
    ],
    [
      "ubah pembayaran",
      "PUT",
      `/activation/${repeaterOld.id}`,
      { status: false },
    ],
    [
      "pindah kelas",
      "PUT",
      `/activation/${repeaterOld.id}/class`,
      { classId: oldClass.id },
    ],
    [
      "tambah asisten",
      "POST",
      "/collaborator",
      { classId: oldClass.id, collaborators: [senior.id] },
    ],
    [
      "hapus asisten",
      "DELETE",
      `/collaborator/${oldClass.id}/${oldAssistant.id}`,
    ],
    [
      "ubah jam sesi lama",
      "PUT",
      `/session/${sessions[0].id}`,
      { startAt: "18.05", endAt: "18.40" },
    ],
    ["hapus jam sesi lama", "DELETE", `/session/${sessions[5].id}`],
  ])
    expect(
      `${labelText}: ditolak`,
      await call(method, path, as(laboran, body)),
      409,
      READ_ONLY
    );

  const detail = await call("GET", `/class/${oldClass.id}`, { token: laboran });
  check(
    "detail kelas lama tetap terbuka, bertanda periode selesai",
    detail.code === 200 &&
      detail.json.data?.period?.name === oldName &&
      detail.json.data.period.is_active === false,
    JSON.stringify(detail.json.data?.period)
  );
  const meetings = await call("GET", `/meeting/${oldClass.id}`, {
    token: laboran,
  });
  check(
    "presensi kelas lama tetap bisa dilihat",
    meetings.code === 200 &&
      meetings.json.data?.[0]?.students?.some(
        (s) => s.student_id === repeater.id && s.is_attended
      ),
    meetings.message
  );
  const oldClasses = await call("GET", `/class?periodId=${old.id}`, {
    token: laboran,
  });
  check(
    "daftar kelas periode lama bisa diminta laboran",
    oldClasses.json.data?.some((c) => c.id === oldClass.id),
    oldClasses.message
  );
  const oldPayments = await call("GET", `/activation?periodId=${old.id}`, {
    token: laboran,
  });
  check(
    "pembayaran periode lama bisa diminta laboran",
    oldPayments.json.data?.some((a) => a.id === repeaterOld.id),
    oldPayments.message
  );

  section("Jam sesi semester baru");
  const copies = await db.mst_session.findMany({
    where: {
      periodId: newPeriodId,
      number: { in: sessions.map((session) => session.number) },
    },
    orderBy: { number: "asc" },
  });
  check(
    "jam sesi semester lama disalin ke semester baru",
    copies.length === sessions.length &&
      copies.every(
        (copy, i) =>
          copy.id !== sessions[i].id &&
          copy.startAt === sessions[i].startAt &&
          copy.endAt === sessions[i].endAt &&
          copy.is_active === sessions[i].is_active
      ),
    JSON.stringify(copies)
  );
  const [oldCount, newCount] = await Promise.all([
    db.mst_session.count({ where: { periodId: old.id } }),
    db.mst_session.count({ where: { periodId: newPeriodId } }),
  ]);
  check(
    "  semua jam sesi ikut disalin, jam sesi lama tetap ada",
    oldCount === newCount && oldCount >= sessions.length,
    `lama ${oldCount}, baru ${newCount}`
  );
  const listed = (await call("GET", "/session", { token: laboran })).json.data;
  const listedIds = new Set(listed?.map((session) => session.id));
  check(
    "  halaman Jam Sesi hanya berisi jam sesi semester baru, mulai dari 0 kelas",
    listed?.length === newCount &&
      copies.every((copy) => listedIds.has(copy.id)) &&
      !sessions.some((session) => listedIds.has(session.id)) &&
      listed
        .filter((session) => copies.some((copy) => copy.id === session.id))
        .every((session) => session.classes === 0),
    JSON.stringify(listed?.slice(0, 3))
  );

  section("Semester baru");
  const currentClasses = await call("GET", "/class", { token: laboran });
  check(
    "daftar kelas bawaan tidak lagi memuat kelas lama",
    currentClasses.code === 200 &&
      !currentClasses.json.data?.some((c) => c.id === oldClass.id),
    currentClasses.message
  );
  const myClasses = await call("GET", "/class/me", { token: mahasiswa });
  check(
    "jadwal mahasiswa di HP kosong (kelas lama tidak tampil)",
    myClasses.code === 200 && myClasses.json.data?.length === 0,
    JSON.stringify(myClasses.json.data)
  );
  const myActivations = await call("GET", "/activation", {
    token: mahasiswa,
  });
  check(
    "mata kuliah terdaftar mahasiswa kosong",
    myActivations.code === 200 && myActivations.json.data?.length === 0,
    JSON.stringify(myActivations.json.data)
  );
  const newClassBody = (sessionId) =>
    as(laboran, {
      subjectId: subject.id,
      name: "A",
      quota: 30,
      day: "MONDAY",
      room: "PSI",
      sessionId,
    });
  expect(
    "kelas baru dengan jam sesi semester lama ditolak",
    await call("POST", "/class", newClassBody(sessions[0].id)),
    400,
    "Sesi tidak ditemukan atau sudah nonaktif!"
  );
  const created = await call("POST", "/class", newClassBody(copies[0].id));
  expect(
    "kelas A dengan hari, jam, dan ruang yang sama boleh dibuat lagi",
    created,
    201,
    "Kelas Uji Periode A berhasil ditambahkan"
  );
  const newClassId = created.json.data?.id;
  expect(
    "mahasiswa mengulang mata kuliah yang sama",
    await call(
      "POST",
      "/activation",
      as(mahasiswa, { subjectIds: [subject.id] })
    ),
    201,
    "Pendaftaran mata kuliah berhasil"
  );
  const repeaterNew = await db.trn_activations.findFirst({
    where: {
      userId: repeater.id,
      subjectId: subject.id,
      periodId: newPeriodId,
    },
  });
  check("  tercatat di periode baru", !!repeaterNew);
  expect(
    "laboran mengonfirmasi dengan kelas A baru (kelas lama di jam yang sama tidak dihitung bentrok)",
    await call(
      "PUT",
      `/activation/${repeaterNew?.id}`,
      as(laboran, { status: true, classId: newClassId })
    ),
    200,
    "Pembayaran dikonfirmasi dan mahasiswa didaftarkan ke kelas A"
  );
  expect(
    "senior yang lulus mata kuliah ini semester lalu boleh jadi asisten",
    await call(
      "POST",
      "/collaborator",
      as(laboran, { classId: newClassId, collaborators: [senior.id] })
    ),
    201,
    "Uji Senior ditambahkan sebagai asisten"
  );
  const nowMine = await call("GET", "/class/me", { token: mahasiswa });
  check(
    "jadwal mahasiswa kini hanya kelas baru",
    nowMine.json.data?.length === 1 && nowMine.json.data[0].id === newClassId,
    JSON.stringify(nowMine.json.data)
  );

  section("Jam sesi");
  expect(
    "mengubah jam sesi semester baru",
    await call(
      "PUT",
      `/session/${copies[0].id}`,
      as(laboran, { startAt: "18.05", endAt: "18.40" })
    ),
    200
  );
  const [oldAfter, newAfter, oldSessionAfter] = await Promise.all([
    db.mst_class.findUnique({ where: { id: oldClass.id } }),
    db.mst_class.findUnique({ where: { id: newClassId } }),
    db.mst_session.findUnique({ where: { id: sessions[0].id } }),
  ]);
  check(
    "  jam kelas baru ikut berubah, kelas dan jam sesi semester lama tetap",
    newAfter.startAt === "18.05" &&
      oldAfter.startAt === oldClass.startAt &&
      oldSessionAfter.startAt === sessions[0].startAt,
    `baru ${newAfter.startAt}, kelas lama ${oldAfter.startAt}, sesi lama ${oldSessionAfter.startAt}`
  );
});
