import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("34");
const NOT_ASSISTANT = "Anda bukan asisten kelas ini.";
const ROUNDS = 5;

await runTest(
  "Data kelas untuk asisten dan satu presensi terbuka per kelas",
  data,
  async () => {
    const alfa = await data.subject("Uji Asisten Kelas Alfa");
    const beta = await data.subject("Uji Asisten Kelas Beta");
    const held = await data.classOf(alfa, "A", "MONDAY", 1);
    const other = await data.classOf(alfa, "B", "TUESDAY", 1);
    const joined = await data.classOf(beta, "A", "WEDNESDAY", 1);
    const oldPeriod = await db.mst_academic_period.create({
      data: { year: "1934/1935", term: "GANJIL", createdBy: data.laboran.id },
    });
    const archived = await data.classOf(alfa, "A", "MONDAY", 1, {
      period: oldPeriod,
    });

    const [assistant, otherAssistant, student] = await data.students(3);
    for (const [user, cls] of [
      [assistant, held],
      [assistant, archived],
      [otherAssistant, other],
    ])
      await db.trn_class_collaborator.create({
        data: { userId: user.id, classId: cls.id },
      });
    await data.activate(assistant, beta, true);
    await data.enroll(assistant, joined);
    await data.activate(student, alfa, true);
    await data.enroll(student, held);

    const [p1, p2, p3] = [
      await data.meeting(held, "Pertemuan 1"),
      await data.meeting(held, "Pertemuan 2"),
      await data.meeting(held, "Pertemuan 3"),
    ];
    const elsewhere = await data.meeting(other, "Pertemuan 1");

    const tokens = {
      laboran: (await login(data.laboran, data.password)).token,
      lecturer: (await login(data.lecturer, data.password)).token,
      assistant: (await login(assistant, data.password)).token,
      student: (await login(student, data.password)).token,
    };
    const access = async (token, cls) => {
      const [detail, assistants] = await Promise.all([
        call("GET", `/class/${cls.id}`, { token }),
        call("GET", `/collaborator/${cls.id}`, { token }),
      ]);
      return { detail, assistants };
    };
    const refused = ({ detail, assistants }) =>
      [detail, assistants].every(
        (res) => res.code === 403 && res.message === NOT_ASSISTANT
      );
    const describe = ({ detail, assistants }) =>
      `${detail.code} ${JSON.stringify(detail.message)} / ${assistants.code} ${JSON.stringify(assistants.message)}`;

    section("Data kelas dan daftar asisten untuk akun mahasiswa");
    const own = await access(tokens.assistant, held);
    check(
      "asisten membuka kelas yang ia pegang: data kelas dan daftar asisten tampil",
      own.detail.code === 200 &&
        own.assistants.code === 200 &&
        own.assistants.json.data.some((row) => row.nim === assistant.nim),
      describe(own)
    );
    const old = await access(tokens.assistant, archived);
    check(
      "kelas yang ia pegang di semester lama tetap bisa dilihat (arsip)",
      old.detail.code === 200 &&
        old.detail.json.data.period?.isActive === false &&
        old.assistants.code === 200,
      describe(old)
    );
    const notHeld = await access(tokens.assistant, other);
    check(
      `asisten membuka kelas lain: ditolak 403 "${NOT_ASSISTANT}"`,
      refused(notHeld),
      describe(notHeld)
    );
    const asStudent = await access(tokens.assistant, joined);
    check(
      "asisten membuka kelas tempat ia ikut praktikum sebagai mahasiswa: ditolak",
      refused(asStudent),
      describe(asStudent)
    );
    const plain = await access(tokens.student, held);
    check(
      "mahasiswa biasa tidak bisa membaca data kelas dan NIM asisten",
      refused(plain),
      describe(plain)
    );
    const staff = await Promise.all([
      access(tokens.laboran, held),
      access(tokens.laboran, other),
      access(tokens.lecturer, held),
    ]);
    check(
      "laboran dan dosen pengampu tetap bisa membuka kelas",
      staff.every(
        ({ detail, assistants }) =>
          detail.code === 200 && assistants.code === 200
      ),
      staff.map(describe).join(" | ")
    );
    const meetings = await call("GET", `/meeting/${held.id}`, {
      token: tokens.student,
    });
    check(
      "HP tidak terpengaruh: mahasiswa tetap menerima daftar pertemuan kelasnya",
      meetings.code === 200 &&
        meetings.json.data.length === 3 &&
        meetings.json.data.every((meeting) => !("students" in meeting)),
      `${meetings.code} ${JSON.stringify(meetings.json.data?.[0])}`
    );

    section("Satu presensi terbuka per kelas");
    const setStatus = (token, meeting, status) =>
      call("PUT", `/meeting/${meeting.id}/status`, {
        token,
        body: { status },
      });
    const openIn = async (cls) =>
      (
        await db.trn_meetings.findMany({
          where: { classId: cls.id, status: true },
          select: { name: true },
        })
      )
        .map((meeting) => meeting.name)
        .sort();
    const secondRefused = (first, second) =>
      `Presensi ${first.name} masih dibuka. Tutup dulu sebelum membuka ${second.name}.`;

    expect(
      "asisten membuka presensi Pertemuan 1",
      await setStatus(tokens.assistant, p1, true),
      200,
      "Sesi presensi dibuka"
    );
    expect(
      "membuka Pertemuan 3 saat Pertemuan 1 masih dibuka: ditolak dengan nama kedua pertemuan",
      await setStatus(tokens.assistant, p3, true),
      409,
      secondRefused(p1, p3)
    );
    expect(
      "laboran juga ditolak membuka Pertemuan 2",
      await setStatus(tokens.laboran, p2, true),
      409,
      secondRefused(p1, p2)
    );
    check(
      "  hanya Pertemuan 1 yang terbuka",
      JSON.stringify(await openIn(held)) === JSON.stringify(["Pertemuan 1"]),
      JSON.stringify(await openIn(held))
    );
    expect(
      "membuka lagi Pertemuan 1 yang sudah terbuka tetap berhasil",
      await setStatus(tokens.assistant, p1, true),
      200,
      "Sesi presensi dibuka"
    );
    expect(
      "kelas lain tetap bisa membuka presensinya sendiri",
      await setStatus(tokens.laboran, elsewhere, true),
      200,
      "Sesi presensi dibuka"
    );
    expect(
      "Pertemuan 1 ditutup",
      await setStatus(tokens.assistant, p1, false),
      200,
      "Sesi presensi ditutup"
    );
    expect(
      "  sesudah itu Pertemuan 3 bisa dibuka",
      await setStatus(tokens.assistant, p3, true),
      200,
      "Sesi presensi dibuka"
    );
    check(
      "  sekarang hanya Pertemuan 3 yang terbuka",
      JSON.stringify(await openIn(held)) === JSON.stringify(["Pertemuan 3"]),
      JSON.stringify(await openIn(held))
    );
    await setStatus(tokens.assistant, p3, false);
    await setStatus(tokens.laboran, elsewhere, false);

    const rounds = [];
    for (let round = 0; round < ROUNDS; round++) {
      const answers = await Promise.all([
        setStatus(tokens.assistant, p1, true),
        setStatus(tokens.laboran, p2, true),
      ]);
      rounds.push({
        codes: answers.map((answer) => answer.code).sort(),
        open: await openIn(held),
      });
      await db.trn_meetings.updateMany({
        where: { classId: held.id },
        data: { status: false },
      });
    }
    check(
      `asisten dan laboran membuka dua pertemuan bersamaan (${ROUNDS} kali): selalu hanya satu yang berhasil`,
      rounds.every(
        (round) =>
          JSON.stringify(round.codes) === JSON.stringify([200, 409]) &&
          round.open.length === 1
      ),
      JSON.stringify(rounds)
    );

    section("Asisten dicabut dari kelas");
    expect(
      "laboran mencabut asisten",
      await call("DELETE", `/collaborator/${held.id}/${assistant.id}`, {
        token: tokens.laboran,
      }),
      200
    );
    const removed = await access(tokens.assistant, held);
    check(
      "  data kelas dan daftar asisten langsung ditolak",
      refused(removed),
      describe(removed)
    );
    expect(
      "  membuka presensi juga ditolak",
      await setStatus(tokens.assistant, p1, true),
      403,
      "Hanya laboran atau asisten kelas ini yang dapat melakukannya!"
    );
  }
);
