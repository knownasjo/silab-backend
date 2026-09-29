import { db, newDeviceId, TestData } from "../bantuan/data.mjs";
import { call, check, expect, login, runTest } from "../bantuan/uji.mjs";

const data = new TestData("18");
const ALREADY = "Anda sudah melakukan presensi untuk pertemuan ini!";

await runTest("Scan QR presensi bersamaan", data, async () => {
  const subject = await data.subject("Uji Scan Ganda");
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const student = await data.student();
  await data.activate(student, subject, true);
  await data.enroll(student, cls);
  const meeting = await data.meeting(cls, "Pertemuan 1", { status: true });
  const laboran = (await login(data.laboran, data.password)).token;
  const mahasiswa = (await login(student, data.password)).token;

  const qr = await call("GET", `/meeting/${meeting.id}/qr`, { token: laboran });
  const qrToken = qr.json.data?.token;
  check(
    "token QR didapat dari layar asisten",
    typeof qrToken === "string",
    qr.message
  );
  const device = newDeviceId();
  const scan = () =>
    call(
      "POST",
      `/subject/classes/${cls.id}/meetings/${meeting.id}/attendances`,
      {
        token: mahasiswa,
        body: { token: qrToken, device_id: device },
      }
    );

  const scans = await Promise.all(Array.from({ length: 5 }, scan));
  const summary = JSON.stringify(scans.map((r) => `${r.code} ${r.message}`));
  check(
    "5 scan bersamaan: tepat satu berhasil",
    scans.filter((r) => r.message === "Presensi berhasil dicatat").length === 1,
    summary
  );
  check(
    "  sisanya dibalas 'sudah melakukan presensi'",
    scans.filter((r) => r.code === 409 && r.message === ALREADY).length === 4,
    summary
  );
  check(
    "  tidak ada error server",
    scans.every((r) => r.code < 500),
    summary
  );
  const records = await db.trn_meeting_participants.count({
    where: { meetingId: meeting.id },
  });
  check(`  presensi tercatat tepat satu (${records})`, records === 1);
  expect(
    "scan ulang belakangan tetap ditolak dengan pesan yang sama",
    await scan(),
    409,
    ALREADY
  );
});
