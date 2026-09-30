import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, findActivePeriod, TestData } from "../bantuan/data.mjs";
import { check, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("21");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TERMS = { GANJIL: "Ganjil", GENAP: "Genap" };
const label = (period) => `${period.year} ${TERMS[period.term]}`;
const nextOf = (period) => {
  if (period.term === "GANJIL") return { year: period.year, term: "GENAP" };
  const start = Number(period.year.split("/")[1]);
  return { year: `${start}/${start + 1}`, term: "GANJIL" };
};
const OLD = { year: "1921/1922", term: "GANJIL" };
const OLD_NAME = label(OLD);

const runScript = (args, input = "") =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(
      "npm",
      ["run", "--silent", "hapus-periode", "--", ...args],
      { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] }
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });

await runTest("Skrip hapus-periode", data, async () => {
  const active = data.period;
  const oldPeriod = await db.mst_academic_period.create({
    data: { ...OLD, created_by: data.laboran.id },
  });
  const subject = await data.subject("Uji Hapus Periode");
  const [paid, unpaid, assistant] = await data.students(3);

  const oldClass = await data.classOf(subject, "A", "MONDAY", 1, {
    period: oldPeriod,
  });
  await data.activate(paid, subject, true, oldPeriod);
  await data.activate(unpaid, subject, false, oldPeriod);
  await data.enroll(paid, oldClass);
  await db.trn_class_collaborator.create({
    data: { userId: assistant.id, classId: oldClass.id },
  });
  const oldMeetings = [
    await data.meeting(oldClass, "Pertemuan 1"),
    await data.meeting(oldClass, "Pertemuan 2"),
  ];
  await data.attend(oldMeetings[0], paid, true);
  await data.attend(oldMeetings[1], paid, false);
  const forSubject = await db.mst_announcement.create({
    data: {
      type: "BASIC",
      title: "Uji Hapus Periode Untuk Mata Kuliah",
      body: "Hanya untuk mahasiswa mata kuliah ini.",
      author: data.laboran.id,
      for_all: false,
      periodId: oldPeriod.id,
      subjects: { create: [{ subjectId: subject.id }] },
    },
  });
  const forAll = await db.mst_announcement.create({
    data: {
      type: "BASIC",
      title: "Uji Hapus Periode Untuk Semua",
      body: "Untuk semua mahasiswa.",
      author: data.laboran.id,
    },
  });

  const currentClass = await data.classOf(subject, "A", "MONDAY", 1);
  await data.activate(paid, subject, true);
  await data.enroll(paid, currentClass);
  const currentMeeting = await data.meeting(currentClass, "Pertemuan 1");
  await data.attend(currentMeeting, paid, true);

  const oldData = async () => {
    const counts = await Promise.all([
      db.mst_academic_period.count({ where: { id: oldPeriod.id } }),
      db.mst_class.count({ where: { id: oldClass.id } }),
      db.trn_meetings.count({ where: { classId: oldClass.id } }),
      db.trn_meeting_participants.count({
        where: { meetingId: { in: oldMeetings.map((m) => m.id) } },
      }),
      db.trn_class_participants.count({ where: { classId: oldClass.id } }),
      db.trn_class_collaborator.count({ where: { classId: oldClass.id } }),
      db.trn_activations.count({ where: { periodId: oldPeriod.id } }),
    ]);
    return counts.join(",");
  };
  const FULL = "1,1,2,2,1,1,2";
  check("data periode lama siap", (await oldData()) === FULL, await oldData());

  section("Menolak tanpa menghapus");
  let run = await runScript([]);
  check(
    "tanpa nama: cara pakai dan daftar periode",
    run.code === 1 &&
      run.output.includes("Cara pakai: npm run hapus-periode") &&
      run.output.includes(`${label(active)} (aktif)`) &&
      run.output.includes(OLD_NAME),
    run.output
  );

  run = await runScript(["semester", "lalu"]);
  check(
    "nama tidak dikenali",
    run.code === 1 &&
      run.output.includes('Nama periode "semester lalu" tidak dikenali.'),
    run.output
  );

  run = await runScript(["1921/1922 Genap"]);
  check(
    "periode tidak ada: ditolak dan daftar periode ditampilkan",
    run.code === 1 &&
      run.output.includes("Periode 1921/1922 Genap tidak ditemukan.") &&
      run.output.includes(OLD_NAME),
    run.output
  );

  run = await runScript([OLD_NAME], "hapus\n");
  const summary = [
    `Periode yang akan dihapus: ${OLD_NAME}`,
    "Kelas praktikum         : 1",
    "Pertemuan               : 2",
    "Riwayat presensi        : 2",
    "Peserta kelas           : 1",
    "Asisten kelas           : 1",
    "Pendaftaran mata kuliah : 2 (1 lunas)",
    "Jam sesi                : 6",
    "Pengumuman mata kuliah  : 1",
    "Tetap tersimpan: akun, mata kuliah, dan pengumuman untuk semua mahasiswa.",
  ];
  const missing = summary.filter((line) => !run.output.includes(line));
  check(
    "ringkasan jumlah data sebelum konfirmasi",
    missing.length === 0,
    `tidak ada: ${missing.join(" | ")}\n${run.output}`
  );
  check(
    '  mengetik "hapus" (huruf kecil) membatalkan',
    run.code === 1 &&
      run.output.includes("Dibatalkan, tidak ada data yang dihapus."),
    run.output
  );
  check(
    "  data periode lama utuh",
    (await oldData()) === FULL,
    await oldData()
  );

  section("Menghapus periode lama");
  run = await runScript(["1921/1922", "ganjil"], "HAPUS\n");
  check(
    "HAPUS: periode lama dihapus (nama tanpa tanda kutip)",
    run.code === 0 &&
      run.output.includes(
        `Periode ${OLD_NAME} dan seluruh datanya sudah dihapus.`
      ),
    run.output
  );
  check(
    "  periode, kelas, pertemuan, presensi, peserta, asisten, pendaftaran hilang",
    (await oldData()) === "0,0,0,0,0,0,0",
    await oldData()
  );
  const announcementExists = async (announcement) =>
    (await db.mst_announcement.count({ where: { id: announcement.id } })) === 1;
  check(
    "  pengumuman mata kuliah periode lama ikut terhapus, pengumuman untuk semua tetap",
    !(await announcementExists(forSubject)) &&
      (await announcementExists(forAll)) &&
      (await db.trn_announcement_subjects.count({
        where: { announcementId: forSubject.id },
      })) === 0
  );
  const sessionsOf = (period) =>
    db.mst_session.count({ where: { periodId: period.id } });
  const activeSessions = await sessionsOf(active);
  check(
    "  jam sesi periode lama ikut terhapus, jam sesi periode aktif tetap",
    (await sessionsOf(oldPeriod)) === 0 &&
      activeSessions >= 6 &&
      (await db.mst_class.findUnique({ where: { id: currentClass.id } }))
        ?.sessionId !== null,
    `lama ${await sessionsOf(oldPeriod)}, aktif ${activeSessions}`
  );
  check(
    "  akun dan mata kuliah tetap ada",
    (await db.mst_user.count({
      where: { id: { in: [paid.id, unpaid.id, assistant.id] } },
    })) === 3 &&
      (await db.mst_subject.count({ where: { id: subject.id } })) === 1
  );
  const current = await Promise.all([
    db.mst_class.count({ where: { id: currentClass.id } }),
    db.trn_class_participants.count({ where: { classId: currentClass.id } }),
    db.trn_meeting_participants.count({
      where: { meetingId: currentMeeting.id },
    }),
    db.trn_activations.count({
      where: { periodId: active.id, subjectId: subject.id },
    }),
  ]);
  check(
    "  kelas, presensi, dan pendaftaran di periode aktif tidak tersentuh",
    current.join(",") === "1,1,1,1",
    current.join(",")
  );
  check(
    "  periode aktif tetap sama",
    (await db.mst_academic_period.count({ where: { id: active.id } })) === 1
  );

  section("Semester yang terlanjur dimulai");
  const accidental = await db.mst_academic_period.create({
    data: { ...nextOf(active), created_by: data.laboran.id },
  });
  const accidentalName = label(accidental);
  const extraClass = await data.classOf(subject, "B", "TUESDAY", 2, {
    period: accidental,
  });
  run = await runScript([accidentalName]);
  check(
    "periode aktif yang sudah berisi kelas ditolak sebelum konfirmasi",
    run.code === 1 &&
      run.output.includes(
        `Periode ${accidentalName} sedang aktif dan sudah berisi 1 kelas dan 0 pendaftaran mata kuliah, jadi tidak bisa dihapus.`
      ) &&
      !run.output.includes("Ketik HAPUS"),
    run.output
  );
  const blocked = await db.mst_academic_period
    .delete({ where: { id: accidental.id } })
    .then(
      () => "terhapus",
      (error) => error.code
    );
  check(
    "  database sendiri menolak menghapus periode yang masih punya kelas",
    blocked === "P2003",
    blocked
  );
  await db.mst_class.delete({ where: { id: extraClass.id } });

  run = await runScript([accidentalName], "hapus\n");
  check(
    "periode aktif kosong: ringkasan menyebut periode yang aktif kembali",
    run.output.includes(
      `Periode yang akan dihapus: ${accidentalName} (aktif, masih kosong)`
    ) &&
      run.output.includes(
        `Setelah dihapus, periode ${label(active)} aktif kembali`
      ) &&
      run.output.includes(
        `Jam sesi semester ini (6) ikut terhapus, dan jam sesi ${label(
          active
        )} dipakai lagi.`
      ),
    run.output
  );
  check(
    "  selain HAPUS dibatalkan",
    run.code === 1 &&
      run.output.includes("Dibatalkan, tidak ada data yang dihapus.") &&
      (await db.mst_academic_period.count({ where: { id: accidental.id } })) ===
        1,
    run.output
  );

  run = await runScript([accidentalName], "HAPUS\n");
  check(
    "HAPUS: semester yang terlanjur dimulai dihapus",
    run.code === 0 &&
      run.output.includes(
        `Periode ${accidentalName} sudah dihapus. Periode aktif sekarang ${label(
          active
        )}.`
      ),
    run.output
  );
  check(
    "  periode sebelumnya aktif kembali",
    (await findActivePeriod())?.id === active.id
  );
  check(
    "  jam sesi semester itu ikut terhapus, jam sesi periode sebelumnya utuh",
    (await sessionsOf(accidental)) === 0 &&
      (await sessionsOf(active)) === activeSessions,
    `terhapus ${await sessionsOf(accidental)}, aktif ${await sessionsOf(
      active
    )}`
  );
});
