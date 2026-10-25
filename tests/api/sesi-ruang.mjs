import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("31");
const toMinutes = (time) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const WINDOW = [toMinutes("22.30"), toMinutes("23.59")];
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

await runTest("Jam sesi per ruangan dan per hari", data, async () => {
  const token = (await login(data.laboran, data.password)).token;
  const all = [];
  const send = async (method, path, body) => {
    const res = await call(method, path, { token, body });
    all.push(res);
    return res;
  };
  const existing = await db.mst_session.findMany({
    where: { periodId: data.period.id },
  });
  const used = new Set(existing.map((session) => session.number));
  const free = Array.from({ length: 20 }, (_, i) => 20 - i).filter(
    (number) => !used.has(number)
  );
  if (
    free.length < 6 ||
    existing.some(
      (session) =>
        toMinutes(session.startAt) < WINDOW[1] &&
        WINDOW[0] < toMinutes(session.endAt)
    )
  )
    throw new Error(
      "Butuh 6 nomor sesi yang kosong di semua hari dan ruangan, serta jam 22.30–23.59 yang kosong"
    );
  const [n1, n2, n3, n4, n5, n6] = free;
  const add = (body) => send("POST", "/session", body);
  const update = (session, body) => send("PUT", `/session/${session.id}`, body);
  const find = (room, day, number) =>
    db.mst_session.findFirst({
      where: { periodId: data.period.id, room, day, number },
    });
  const clear = () =>
    db.mst_session.deleteMany({
      where: {
        periodId: data.period.id,
        createdBy: data.laboran.id,
        number: { lte: 20 },
      },
    });

  section("Tiap ruangan punya jam sesinya sendiri");
  const psi = await add({
    room: "PSI",
    day: "THURSDAY",
    number: n1,
    startAt: "22.30",
    endAt: "22.40",
  });
  const sbti = await add({
    room: "SBTI",
    day: "THURSDAY",
    number: n1,
    startAt: "22.35",
    endAt: "22.45",
  });
  check(
    `Sesi ${n1} Kamis PSI 22.30–22.40 dan Sesi ${n1} Kamis SBTI 22.35–22.45 boleh sama-sama ada`,
    psi.code === 201 &&
      psi.message === `Sesi ${n1} Kamis PSI berhasil ditambahkan` &&
      sbti.code === 201 &&
      sbti.message === `Sesi ${n1} Kamis SBTI berhasil ditambahkan` &&
      psi.json.data?.room === "PSI" &&
      sbti.json.data?.day === "THURSDAY",
    `${psi.code} ${psi.message} | ${sbti.code} ${sbti.message}`
  );
  expect(
    "  jam yang bertabrakan di ruangan yang sama tetap ditolak",
    await add({
      room: "PSI",
      day: "THURSDAY",
      number: n2,
      startAt: "22.35",
      endAt: "22.50",
    }),
    409,
    `Jam sesi bertabrakan dengan Sesi ${n1} Kamis PSI (22.30–22.40)!`
  );
  const onlySbti = await send("GET", "/session?room=SBTI&day=THURSDAY");
  check(
    "GET /session?room=SBTI&day=THURSDAY hanya berisi sesi Kamis SBTI",
    onlySbti.code === 200 &&
      onlySbti.json.data.length > 0 &&
      onlySbti.json.data.every(
        (s) => s.room === "SBTI" && s.day === "THURSDAY"
      ) &&
      onlySbti.json.data.some((s) => s.id === sbti.json.data.id),
    `${onlySbti.code} ${onlySbti.json.data?.length}`
  );
  const everything = (await send("GET", "/session")).json.data;
  const sorted = [...everything].sort(
    (a, b) =>
      a.room.localeCompare(b.room) ||
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
      toMinutes(a.startAt) - toMinutes(b.startAt)
  );
  check(
    "  GET /session urut ruangan, lalu hari Senin–Jumat, lalu jam mulai",
    everything.map((s) => s.id).join() === sorted.map((s) => s.id).join()
  );
  const blank = await send("GET", "/session?room=&day=&active=");
  check(
    "  GET dengan room, day, dan active kosong (seperti Postman) sama dengan tanpa saringan",
    blank.code === 200 && blank.json.data?.length === everything.length,
    `${blank.code} ${blank.message} ${blank.json.data?.length}/${everything.length}`
  );
  for (const [label, path, message] of [
    [
      "ruangan tidak dikenal",
      "/session?room=LAB3",
      "Ruangan harus PSI atau SBTI!",
    ],
    [
      "hari tidak dikenal",
      "/session?day=SUNDAY",
      "Hari harus Senin sampai Jumat!",
    ],
  ])
    expect(`  GET dengan ${label}: 400`, await send("GET", path), 400, message);
  for (const [label, body, message] of [
    ["tanpa ruangan", { day: "THURSDAY" }, "Ruangan harus PSI atau SBTI!"],
    [
      "ruangan huruf kecil",
      { room: "psi", day: "THURSDAY" },
      "Ruangan harus PSI atau SBTI!",
    ],
    [
      "hari Sabtu",
      { room: "PSI", day: "SATURDAY" },
      "Hari harus Senin sampai Jumat!",
    ],
    [
      "hari lain berupa teks",
      { room: "PSI", day: "THURSDAY", alsoDays: "MONDAY" },
      "Hari lain harus berisi hari Senin sampai Jumat!",
    ],
    [
      "hari lain berisi Sabtu",
      { room: "PSI", day: "THURSDAY", alsoDays: ["MONDAY", "SATURDAY"] },
      "Hari lain harus berisi hari Senin sampai Jumat!",
    ],
  ])
    expect(
      `POST ${label}: 400`,
      await add({ number: n3, startAt: "23.00", endAt: "23.10", ...body }),
      400,
      message
    );
  await clear();

  section("Tambahkan juga ke hari lain");
  const many = await add({
    room: "PSI",
    day: "TUESDAY",
    number: n3,
    startAt: "22.30",
    endAt: "22.40",
    alsoDays: ["MONDAY", "TUESDAY", "FRIDAY", "MONDAY"],
  });
  const createdMany = await db.mst_session.findMany({
    where: { periodId: data.period.id, room: "PSI", number: n3 },
  });
  check(
    "satu simpan membuat sesi di Selasa, Senin dan Jumat (hari ganda diabaikan)",
    many.code === 201 &&
      many.message ===
        `Sesi ${n3} PSI hari Senin, Selasa dan Jumat berhasil ditambahkan` &&
      many.json.data?.day === "TUESDAY" &&
      createdMany.length === 3 &&
      createdMany.every((s) => s.startAt === "22.30" && s.endAt === "22.40"),
    `${many.code} ${many.message} ${createdMany.map((s) => s.day)}`
  );
  await add({
    room: "PSI",
    day: "WEDNESDAY",
    number: n4,
    startAt: "22.30",
    endAt: "22.40",
  });
  expect(
    "satu hari bertabrakan: semua ditolak dan pesannya menyebut hari itu",
    await add({
      room: "PSI",
      day: "THURSDAY",
      number: n5,
      startAt: "22.35",
      endAt: "22.45",
      alsoDays: ["WEDNESDAY"],
    }),
    409,
    `Jam sesi bertabrakan dengan Sesi ${n4} Rabu PSI (22.30–22.40)!`
  );
  check(
    "  tidak ada sesi yang tersimpan di Kamis",
    !(await find("PSI", "THURSDAY", n5))
  );

  section("Ubah juga di hari lain");
  const tuesday = await find("PSI", "TUESDAY", n3);
  const both = await update(tuesday, {
    number: n3,
    startAt: "22.45",
    endAt: "22.55",
    alsoDays: ["MONDAY"],
  });
  const [mondayAfter, tuesdayAfter, fridayAfter] = await Promise.all(
    ["MONDAY", "TUESDAY", "FRIDAY"].map((day) => find("PSI", day, n3))
  );
  check(
    "ubah Selasa dan centang Senin: keduanya berubah, Jumat tetap",
    both.code === 200 &&
      both.message ===
        `Sesi ${n3} PSI hari Senin dan Selasa berhasil diperbarui` &&
      JSON.stringify(both.json.warnings) === "[]" &&
      mondayAfter.startAt === "22.45" &&
      tuesdayAfter.endAt === "22.55" &&
      fridayAfter.startAt === "22.30",
    `${both.code} ${both.message} ${mondayAfter.startAt} ${tuesdayAfter.startAt} ${fridayAfter.startAt}`
  );
  expect(
    "hari lain yang tidak punya nomor sesi itu: 404 dan tidak ada yang berubah",
    await update(tuesday, {
      startAt: "23.00",
      endAt: "23.10",
      alsoDays: ["WEDNESDAY"],
    }),
    404,
    `Sesi ${n3} Rabu PSI tidak ditemukan!`
  );
  check(
    "  Selasa tetap 22.45",
    (await find("PSI", "TUESDAY", n3)).startAt === "22.45"
  );
  await add({
    room: "PSI",
    day: "FRIDAY",
    number: n6,
    startAt: "23.00",
    endAt: "23.10",
  });
  expect(
    "hari lain yang jadi bertabrakan: semua ditolak",
    await update(tuesday, {
      startAt: "22.50",
      endAt: "23.05",
      alsoDays: ["FRIDAY", "MONDAY"],
    }),
    409,
    `Jam sesi bertabrakan dengan Sesi ${n6} Jumat PSI (23.00–23.10)!`
  );
  const [mondayKept, tuesdayKept] = await Promise.all(
    ["MONDAY", "TUESDAY"].map((day) => find("PSI", day, n3))
  );
  check(
    "  Senin dan Selasa tetap 22.45",
    mondayKept.startAt === "22.45" && tuesdayKept.startAt === "22.45"
  );
  const renumbered = await update(tuesday, {
    number: n5,
    alsoDays: ["MONDAY", "FRIDAY"],
  });
  const afterRenumber = await db.mst_session.findMany({
    where: { periodId: data.period.id, room: "PSI", number: { in: [n3, n5] } },
  });
  check(
    `ganti nomor ke ${n5} di tiga hari sekaligus`,
    renumbered.code === 200 &&
      afterRenumber.length === 3 &&
      afterRenumber.every((s) => s.number === n5) &&
      afterRenumber.every((s) => s.startAt === "22.45"),
    `${renumbered.code} ${renumbered.message} ${afterRenumber.map((s) => `${s.day} ${s.number} ${s.startAt}`)}`
  );
  await clear();

  section("Kelas harus memakai sesi hari dan ruangannya");
  const [mondayPsi] = await data.sessions();
  const subject = await data.subject("Uji Sesi Ruang Kelas");
  const newClass = (body) =>
    send("POST", "/class", {
      subjectId: subject.id,
      name: "A",
      quota: 20,
      ...body,
    });
  expect(
    "sesi PSI untuk kelas SBTI: ditolak",
    await newClass({ day: "MONDAY", room: "SBTI", sessionId: mondayPsi.id }),
    400,
    `Sesi ${mondayPsi.number} bukan sesi hari Senin di ruang SBTI!`
  );
  expect(
    "sesi Senin untuk kelas Selasa: ditolak",
    await newClass({ day: "TUESDAY", room: "PSI", sessionId: mondayPsi.id }),
    400,
    `Sesi ${mondayPsi.number} bukan sesi hari Selasa di ruang PSI!`
  );
  const made = await newClass({
    day: "MONDAY",
    room: "PSI",
    sessionId: mondayPsi.id,
  });
  expect("sesi yang cocok: diterima", made, 201);
  expect(
    "  pindah ruangan tanpa memilih sesi baru: ditolak",
    await send("PUT", `/class/${made.json.data?.id}`, { room: "SBTI" }),
    400,
    `Sesi ${mondayPsi.number} bukan sesi hari Senin di ruang SBTI!`
  );

  section("Peringatan bila jam sesi membuat jadwal bentrok");
  const [physics, network, algorithm] = await Promise.all([
    data.subject("Uji Bentrok Fisika"),
    data.subject("Uji Bentrok Jaringan"),
    data.subject("Uji Bentrok Algoritma"),
  ]);
  const sessionAt = async (room, number, startAt, endAt) =>
    (await add({ room, day: "THURSDAY", number, startAt, endAt })).json.data;
  const psiEarly = await sessionAt("PSI", n1, "22.30", "22.50");
  const sbtiMiddle = await sessionAt("SBTI", n1, "23.00", "23.20");
  const psiLate = await sessionAt("PSI", n2, "23.30", "23.50");
  const classIn = async (target, session, room) =>
    (
      await send("POST", "/class", {
        subjectId: target.id,
        name: "A",
        quota: 20,
        day: "THURSDAY",
        room,
        sessionId: session.id,
      })
    ).json.data;
  const early = await classIn(physics, psiEarly, "PSI");
  const middle = await classIn(network, sbtiMiddle, "SBTI");
  const late = await classIn(algorithm, psiLate, "PSI");
  const [student, assistant] = await Promise.all([
    data.student("Uji Bentrok Peserta"),
    data.student("Uji Bentrok Asisten"),
  ]);
  await data.enroll(student, early);
  await data.enroll(student, middle);
  await data.enroll(assistant, late);
  await db.trn_class_collaborator.create({
    data: { userId: assistant.id, classId: middle.id },
  });

  const calm = await update(sbtiMiddle, { startAt: "23.00", endAt: "23.25" });
  check(
    "jam baru yang tidak membuat bentrok: tanpa peringatan",
    calm.code === 200 &&
      calm.message ===
        `Sesi ${n1} Kamis SBTI berhasil diperbarui; jam 1 kelas ikut berubah` &&
      JSON.stringify(calm.json.warnings) === "[]",
    `${calm.code} ${calm.message} ${JSON.stringify(calm.json.warnings)}`
  );
  const clash = await update(sbtiMiddle, { startAt: "22.40", endAt: "23.40" });
  const expected = [
    `Uji Bentrok Jaringan kelas A (Kamis, 22.40 - 23.40, SBTI): asisten Uji Bentrok Asisten juga mengikuti praktikum Uji Bentrok Algoritma kelas A (Kamis, 23.30 - 23.50, PSI)`,
    `Uji Bentrok Jaringan kelas A (Kamis, 22.40 - 23.40, SBTI): peserta Uji Bentrok Peserta juga mengikuti praktikum Uji Bentrok Fisika kelas A (Kamis, 22.30 - 22.50, PSI)`,
  ];
  check(
    "jam baru yang membuat peserta dan asisten bentrok: tetap disimpan, dengan peringatan yang menyebut nama dan kelasnya",
    clash.code === 200 &&
      clash.message ===
        `Sesi ${n1} Kamis SBTI berhasil diperbarui; jam 1 kelas ikut berubah. Perhatian, 2 jadwal jadi bentrok.` &&
      JSON.stringify([...(clash.json.warnings ?? [])].sort()) ===
        JSON.stringify(expected),
    `${clash.code} ${clash.message} ${JSON.stringify(clash.json.warnings)}`
  );
  const [middleAfter, sessionAfter] = await Promise.all([
    db.mst_class.findUnique({ where: { id: middle.id } }),
    db.mst_session.findUnique({ where: { id: sbtiMiddle.id } }),
  ]);
  check(
    "  jam sesi dan jam kelasnya benar-benar berubah",
    sessionAfter.startAt === "22.40" &&
      middleAfter.startAt === "22.40" &&
      middleAfter.endAt === "23.40",
    `${sessionAfter.startAt} ${middleAfter.startAt}-${middleAfter.endAt}`
  );
  const toggled = await update(sbtiMiddle, { isActive: false });
  check(
    "  menonaktifkan sesi yang jamnya tidak berubah: tanpa peringatan",
    toggled.code === 200 && JSON.stringify(toggled.json.warnings) === "[]",
    `${toggled.code} ${JSON.stringify(toggled.json.warnings)}`
  );

  check(
    `tidak ada error server dari ${all.length} permintaan`,
    all.every((r) => r.code < 500),
    JSON.stringify(all.filter((r) => r.code >= 500).map((r) => r.message))
  );
});
