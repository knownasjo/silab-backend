import { TestData, db } from "../bantuan/data.mjs";
import { call, check, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("33");

await runTest("Dashboard dosen dan pertemuan yang sudah berjalan", data, async () => {
  const alfa = await data.subject("Uji Dashboard Dosen Alfa");
  const beta = await data.subject("Uji Dashboard Dosen Beta");
  const alfaA = await data.classOf(alfa, "A", "MONDAY", 1);
  await data.classOf(alfa, "B", "TUESDAY", 1);
  const betaA = await data.classOf(beta, "A", "WEDNESDAY", 1);
  const removed = await data.classOf(beta, "B", "THURSDAY", 1);

  const [s1, s2, s3, leaver] = await data.students(4);
  for (const student of [s1, s2, s3, leaver]) await data.enroll(student, alfaA);
  await data.enroll(s3, betaA);
  await data.enroll(leaver, betaA);

  const alfaMeetings = [];
  for (let i = 1; i <= 4; i++)
    alfaMeetings.push(
      await data.meeting(alfaA, `Pertemuan ${i}`, { status: i === 2 })
    );
  const [p1, p2, , p4] = alfaMeetings;
  await data.attend(p1, s1, true);
  await data.attend(p1, s2, true);
  await data.attend(p1, s3, false);
  const deletedMeeting = await data.meeting(alfaA, "Pertemuan 5");
  await data.attend(deletedMeeting, s1, true);
  await db.trn_meetings.update({
    where: { id: deletedMeeting.id },
    data: { deletedAt: new Date() },
  });

  const betaFirst = await data.meeting(betaA, "Pertemuan 1");
  const betaSecond = await data.meeting(betaA, "Pertemuan 2");
  await data.attend(betaFirst, leaver, true);
  await db.trn_class_participants.updateMany({
    where: { userId: leaver.id },
    data: { deletedAt: new Date() },
  });

  const removedMeeting = await data.meeting(removed, "Pertemuan 1");
  await data.attend(removedMeeting, s1, true);
  await db.mst_class.update({
    where: { id: removed.id },
    data: { deletedAt: new Date() },
  });

  const otherLecturer = await data.user("DOSEN", "Dosen Lain Dashboard");
  const otherSubject = await db.mst_subject.create({
    data: {
      subjectCode: data.nextCode(),
      subjectName: "Uji Dashboard Dosen Lain",
      semester: "3",
      lecturerId: otherLecturer.id,
      createdBy: data.laboran.id,
    },
  });
  const otherClass = await data.classOf(otherSubject, "A", "FRIDAY", 1);
  await data.enroll(s1, otherClass);
  const otherMeeting = await data.meeting(otherClass, "Pertemuan 1");
  await data.attend(otherMeeting, s1, true);

  const lecturer = (await login(data.lecturer, data.password)).token;
  const laboran = (await login(data.laboran, data.password)).token;
  const student = (await login(s1, data.password)).token;
  const summary = async () =>
    (await call("GET", "/dashboard/dosen", { token: lecturer })).json.data;

  section("Angka dashboard");
  const first = await summary();
  check(
    "Jumlah Pertemuan hanya menghitung pertemuan yang sedang dibuka atau sudah punya presensi (3)",
    first?.totalMeeting === 3,
    JSON.stringify(first)
  );
  check(
    "Jumlah Kelas (3) dan Jumlah Mahasiswa (3, dihitung sekali, tanpa yang keluar kelas) tetap",
    first?.totalClass === 3 && first?.totalStudent === 3,
    JSON.stringify(first)
  );
  check(
    "respons tidak lagi berisi persentase kehadiran",
    !!first &&
      !["attendanceRate", "totalAttended", "totalExpectedAttendance"].some(
        (key) => key in first
      ),
    JSON.stringify(first)
  );

  section("Tanda isHeld di daftar pertemuan");
  const heldOf = async (token, cls) =>
    Object.fromEntries(
      ((await call("GET", `/meeting/${cls.id}`, { token })).json.data ?? []).map(
        (meeting) => [meeting.meetingName, meeting.isHeld]
      )
    );
  for (const [label, token] of [
    ["dosen pengampu", lecturer],
    ["laboran", laboran],
  ]) {
    const alfaHeld = await heldOf(token, alfaA);
    const betaHeld = await heldOf(token, betaA);
    check(
      `${label}: P1 (ada presensi) dan P2 (sedang dibuka) berjalan, P3 dan P4 belum`,
      JSON.stringify(alfaHeld) ===
        JSON.stringify({
          "Pertemuan 1": true,
          "Pertemuan 2": true,
          "Pertemuan 3": false,
          "Pertemuan 4": false,
        }),
      JSON.stringify(alfaHeld)
    );
    check(
      `${label}: presensi mahasiswa yang sudah keluar kelas tetap menandai pertemuan berjalan`,
      JSON.stringify(betaHeld) ===
        JSON.stringify({ "Pertemuan 1": true, "Pertemuan 2": false }),
      JSON.stringify(betaHeld)
    );
  }
  const own = (await call("GET", `/meeting/${alfaA.id}`, { token: student }))
    .json.data;
  check(
    "mahasiswa tetap menerima bentuk lama (isOpen, submittedAt, isAttended) tanpa isHeld",
    Array.isArray(own) &&
      own.length === 4 &&
      own.every(
        (meeting) =>
          !("isHeld" in meeting) &&
          "isOpen" in meeting &&
          "submittedAt" in meeting &&
          "isAttended" in meeting
      ),
    JSON.stringify(own?.[0])
  );

  section("Angka ikut berubah");
  const open = await call("PUT", `/meeting/${betaSecond.id}/status`, {
    token: laboran,
    body: { status: true },
  });
  const opened = await summary();
  const close = await call("PUT", `/meeting/${betaSecond.id}/status`, {
    token: laboran,
    body: { status: false },
  });
  const closedEmpty = await summary();
  check(
    "presensi P2 Beta dibuka langsung terhitung (4), ditutup tanpa presensi kembali 3",
    open.code === 200 &&
      close.code === 200 &&
      opened?.totalMeeting === 4 &&
      closedEmpty?.totalMeeting === 3,
    `${open.code} ${opened?.totalMeeting} lalu ${close.code} ${closedEmpty?.totalMeeting}`
  );
  const edited = await call("PUT", `/meeting/${p4.id}/attendances/${s2.id}`, {
    token: laboran,
    body: { status: false },
  });
  const afterEdit = await summary();
  const p4Held = (await heldOf(lecturer, alfaA))["Pertemuan 4"];
  check(
    "presensi yang diisi laboran membuat P4 terhitung berjalan (4)",
    edited.code === 200 && afterEdit?.totalMeeting === 4 && p4Held === true,
    `${edited.code} ${afterEdit?.totalMeeting} ${p4Held}`
  );
  await call("PUT", `/meeting/${p2.id}/status`, {
    token: laboran,
    body: { status: false },
  });
  const p2Closed = await summary();
  check(
    "P2 ditutup tanpa presensi tidak terhitung lagi (3)",
    p2Closed?.totalMeeting === 3,
    JSON.stringify(p2Closed)
  );
});
