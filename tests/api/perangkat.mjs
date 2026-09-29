import { db, newDeviceId, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("22");
const UPDATE_APP =
  "Perbarui aplikasi SILAB ke versi terbaru untuk melakukan presensi.";
const DEVICE_USED = "HP ini sudah dipakai presensi akun lain di pertemuan ini.";
const ALREADY = "Anda sudah melakukan presensi untuk pertemuan ini!";
const SAVED = "Presensi berhasil dicatat";
const NOTHING_TO_CHECK = "Presensi ini tidak perlu dicek.";
const ALREADY_CHECKED = "Presensi ini sudah dicek.";

await runTest("Satu HP satu akun per pertemuan", data, async () => {
  const subject = await data.subject("Uji Perangkat");
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const [andi, budi, citra, dedi, eko] = await data.students(5, (i) =>
    [
      "Andi Perangkat",
      "Budi Perangkat",
      "Citra Perangkat",
      "Dedi Perangkat",
      "Eko Perangkat",
    ][i]
  );
  for (const student of [andi, budi, citra, dedi, eko]) {
    await data.activate(student, subject, true);
    await data.enroll(student, cls);
  }
  const [m1, m2, m3] = [
    await data.meeting(cls, "Pertemuan 1", { status: true }),
    await data.meeting(cls, "Pertemuan 2", { status: true }),
    await data.meeting(cls, "Pertemuan 3", { status: true }),
  ];
  const phone = {
    andi: newDeviceId(),
    andiNew: newDeviceId(),
    budi: newDeviceId(),
    citra: newDeviceId(),
    shared: newDeviceId(),
  };

  const laboran = (await login(data.laboran, data.password)).token;
  const loginWith = (user, device_id) =>
    call("POST", "/auth/login", {
      body: { nim: user.nim, password: data.password, device_id },
    });
  const tokenOf = async (user, device) =>
    (await loginWith(user, device)).json.data?.accessToken;
  const qrOf = async (meeting) =>
    (await call("GET", `/meeting/${meeting.id}/qr`, { token: laboran })).json
      .data?.token;
  const scan = async (token, meeting, device_id) =>
    call(
      "POST",
      `/subject/classes/${cls.id}/meetings/${meeting.id}/attendances`,
      { token, body: { token: await qrOf(meeting), device_id } }
    );
  const recordOf = (meeting, user) =>
    db.trn_meeting_participants.findUnique({
      where: { meetingId_userId: { meetingId: meeting.id, userId: user.id } },
    });
  const devicesOf = (user) =>
    db.trn_user_devices.findMany({
      where: { userId: user.id },
      orderBy: { first_seen_at: "asc" },
    });

  section("Login mencatat HP mahasiswa");
  const andiToken = await tokenOf(andi, phone.andi);
  check("login dengan kode HP berhasil", typeof andiToken === "string");
  let devices = await devicesOf(andi);
  check(
    "  HP pertama akun menjadi perangkat biasa",
    devices.length === 1 &&
      devices[0].device_id === phone.andi &&
      devices[0].is_usual,
    JSON.stringify(devices)
  );
  await tokenOf(andi, phone.andiNew);
  devices = await devicesOf(andi);
  check(
    "  login dari HP lain tercatat, tetapi bukan perangkat biasa",
    devices.length === 2 && devices[1].is_usual === false,
    JSON.stringify(devices)
  );
  const staffLogin = await loginWith(data.laboran, newDeviceId());
  check(
    "  login laboran berhasil tanpa mencatat HP",
    staffLogin.code === 200 &&
      (await db.trn_user_devices.count({
        where: { userId: data.laboran.id },
      })) === 0,
    staffLogin.message
  );
  const oldApp = await call("POST", "/auth/login", {
    body: { nim: budi.nim, password: data.password },
  });
  check(
    "  login tanpa kode HP (web, aplikasi lama) tetap berhasil",
    oldApp.code === 200,
    oldApp.message
  );
  const badDevice = await loginWith(budi, "bukan-kode-hp");
  check(
    "  kode HP rusak saat login diabaikan, login tetap berhasil",
    badDevice.code === 200 && (await devicesOf(budi)).length === 0,
    badDevice.message
  );

  section("Kode HP wajib saat scan");
  expect(
    "scan tanpa kode HP ditolak",
    await scan(andiToken, m1),
    400,
    UPDATE_APP
  );
  expect(
    "scan dengan kode HP rusak ditolak",
    await scan(andiToken, m1, "12345"),
    400,
    UPDATE_APP
  );
  check("  tidak ada presensi tercatat", !(await recordOf(m1, andi)));

  section("Satu HP satu akun per pertemuan");
  expect(
    "Andi scan dengan HP-nya",
    await scan(andiToken, m1, phone.andi),
    201,
    SAVED
  );
  let record = await recordOf(m1, andi);
  check(
    "  tercatat dengan kode HP dan status BIASA",
    record?.device_id === phone.andi && record?.device_check === "BIASA",
    JSON.stringify(record)
  );
  const budiToken = await tokenOf(budi, phone.budi);
  expect(
    "akun Budi di HP Andi pada pertemuan yang sama ditolak",
    await scan(budiToken, m1, phone.andi),
    409,
    DEVICE_USED
  );
  check("  presensi Budi tidak tercatat", !(await recordOf(m1, budi)));
  expect(
    "kode HP huruf besar dianggap sama",
    await scan(budiToken, m1, phone.andi.toUpperCase()),
    409,
    DEVICE_USED
  );
  expect(
    "Andi scan ulang tetap dibalas 'sudah melakukan presensi'",
    await scan(andiToken, m1, phone.andi),
    409,
    ALREADY
  );
  expect(
    "Budi scan dengan HP-nya sendiri berhasil",
    await scan(budiToken, m1, phone.budi),
    201,
    SAVED
  );

  section("Perangkat tidak biasa");
  expect(
    "akun Budi scan dari HP Andi di pertemuan lain",
    await scan(budiToken, m2, phone.andi),
    201,
    SAVED
  );
  record = await recordOf(m2, budi);
  check(
    "  tercatat dengan status TIDAK_BIASA",
    record?.device_check === "TIDAK_BIASA",
    JSON.stringify(record)
  );
  expect(
    "  Andi lalu tidak bisa memakai HP-nya sendiri di pertemuan itu",
    await scan(andiToken, m2, phone.andi),
    409,
    DEVICE_USED
  );
  const citraToken = (await login(citra, data.password)).token;
  expect(
    "Citra yang belum pernah mencatat HP scan pertama kali",
    await scan(citraToken, m2, phone.citra),
    201,
    SAVED
  );
  record = await recordOf(m2, citra);
  check(
    "  HP itu menjadi perangkat biasanya (BIASA)",
    record?.device_check === "BIASA" &&
      (await devicesOf(citra))[0]?.is_usual === true,
    JSON.stringify(record)
  );

  section("Scan bersamaan dari satu HP");
  const tokens = await Promise.all(
    [andi, citra, dedi, eko].map((user) => tokenOf(user, phone.shared))
  );
  const scans = await Promise.all(
    tokens.map((token) => scan(token, m3, phone.shared))
  );
  const summary = JSON.stringify(scans.map((r) => `${r.code} ${r.message}`));
  check(
    "4 akun scan bersamaan dari satu HP: tepat satu berhasil",
    scans.filter((r) => r.code === 201).length === 1,
    summary
  );
  check(
    "  sisanya ditolak karena HP sudah dipakai",
    scans.filter((r) => r.code === 409 && r.message === DEVICE_USED)
      .length === 3,
    summary
  );
  check("  tidak ada error server", scans.every((r) => r.code < 500), summary);
  check(
    "  hanya satu presensi dari HP itu di pertemuan 3",
    (await db.trn_meeting_participants.count({
      where: { meetingId: m3.id, device_id: phone.shared },
    })) === 1
  );

  section("Presensi manual oleh laboran");
  for (const user of [dedi, eko]) {
    await call("PUT", `/meeting/${m1.id}/attendances/${user.id}`, {
      token: laboran,
      body: { status: true },
    });
  }
  const manual = await db.trn_meeting_participants.findMany({
    where: { meetingId: m1.id, userId: { in: [dedi.id, eko.id] } },
  });
  check(
    "dua presensi manual tercatat tanpa kode HP",
    manual.length === 2 &&
      manual.every((r) => r.status && r.device_id === null),
    JSON.stringify(manual)
  );

  section("Daftar presensi untuk asisten dan dosen");
  const fajar = await data.student("Fajar Asisten");
  await db.trn_class_collaborator.create({
    data: { userId: fajar.id, classId: cls.id },
  });
  const fajarToken = (await login(fajar, data.password)).token;
  const dosenToken = (await login(data.lecturer, data.password)).token;
  const studentsOf = async (token, meeting) =>
    (await call("GET", `/meeting/${cls.id}`, { token })).json.data?.find(
      (m) => m.id === meeting.id
    )?.students ?? [];
  const rowOf = (rows, user) => rows.find((r) => r.student_id === user.id);
  const m2Rows = await studentsOf(fajarToken, m2);
  check(
    "asisten melihat status HP tiap mahasiswa",
    rowOf(m2Rows, budi)?.device_check === "TIDAK_BIASA" &&
      rowOf(m2Rows, citra)?.device_check === "BIASA" &&
      rowOf(m2Rows, andi)?.device_check === null,
    JSON.stringify(m2Rows)
  );
  check(
    "  dosen juga melihatnya",
    rowOf(await studentsOf(dosenToken, m2), budi)?.device_check ===
      "TIDAK_BIASA"
  );
  const ownView = await call("GET", `/meeting/${cls.id}`, {
    token: budiToken,
  });
  check(
    "  mahasiswa tidak melihat status HP",
    ownView.code === 200 &&
      !JSON.stringify(ownView.json).includes("device_check"),
    JSON.stringify(ownView.json.data?.[0])
  );

  section("Cek HP tidak biasa: Ada / Tidak ada");
  const checkDevice = (token, meeting, user, present) =>
    call("PUT", `/meeting/${meeting.id}/attendances/${user.id}/device`, {
      token,
      body: { present },
    });
  const usualOf = async (user) =>
    JSON.stringify(
      (await devicesOf(user)).filter((d) => d.is_usual).map((d) => d.device_id)
    );
  expect(
    "dosen tidak bisa menekan tombol",
    await checkDevice(dosenToken, m2, budi, true),
    403
  );
  expect(
    "mahasiswa yang bukan asisten tidak bisa menekan tombol",
    await checkDevice(andiToken, m2, budi, true),
    403
  );
  expect(
    "pilihan selain true/false ditolak",
    await checkDevice(fajarToken, m2, budi, "ya"),
    400,
    "Pilihan harus berupa true atau false!"
  );
  expect(
    "presensi dari HP biasa tidak perlu dicek",
    await checkDevice(fajarToken, m2, citra, true),
    409,
    NOTHING_TO_CHECK
  );
  expect(
    "presensi manual (tanpa kode HP) tidak perlu dicek",
    await checkDevice(fajarToken, m1, dedi, true),
    409,
    NOTHING_TO_CHECK
  );
  expect(
    "mahasiswa yang belum presensi tidak bisa dicek",
    await checkDevice(fajarToken, m2, andi, true),
    404,
    "Catatan presensi tidak ditemukan!"
  );
  check(
    "  status Budi belum berubah",
    (await recordOf(m2, budi))?.device_check === "TIDAK_BIASA"
  );

  expect(
    "asisten menekan Ada untuk Budi",
    await checkDevice(fajarToken, m2, budi, true),
    200,
    "Budi Perangkat ditandai hadir. HP ini sekarang menjadi HP biasanya."
  );
  record = await recordOf(m2, budi);
  check(
    "  presensi tetap hadir dan ditandai sudah dicek",
    record?.status === true && record?.device_check === "SUDAH_DICEK",
    JSON.stringify(record)
  );
  check(
    "  HP itu menggantikan HP biasa Budi yang lama",
    (await usualOf(budi)) === JSON.stringify([phone.andi]),
    JSON.stringify(await devicesOf(budi))
  );
  expect(
    "  tombol ditekan lagi: sudah dicek",
    await checkDevice(fajarToken, m2, budi, false),
    409,
    ALREADY_CHECKED
  );

  const m4 = await data.meeting(cls, "Pertemuan 4", { status: true });
  expect(
    "Budi scan dengan HP lamanya di pertemuan 4",
    await scan(budiToken, m4, phone.budi),
    201,
    SAVED
  );
  check(
    "  HP lama sekarang bukan HP biasa (TIDAK_BIASA)",
    (await recordOf(m4, budi))?.device_check === "TIDAK_BIASA"
  );
  expect(
    "laboran menekan Tidak ada untuk Budi",
    await checkDevice(laboran, m4, budi, false),
    200,
    "Budi Perangkat ditandai tidak hadir."
  );
  record = await recordOf(m4, budi);
  check(
    "  presensi menjadi tidak hadir dan sudah dicek",
    record?.status === false && record?.device_check === "SUDAH_DICEK",
    JSON.stringify(record)
  );
  check(
    "  HP biasa Budi tidak berubah",
    (await usualOf(budi)) === JSON.stringify([phone.andi])
  );
  const budiRow = rowOf(await studentsOf(fajarToken, m4), budi);
  check(
    "  daftar presensi ikut berubah",
    budiRow?.is_attended === false && budiRow?.device_check === "SUDAH_DICEK",
    JSON.stringify(budiRow)
  );

  section("Dua staf menekan bersamaan");
  expect(
    "Andi scan dari HP barunya di pertemuan 4",
    await scan(andiToken, m4, phone.andiNew),
    201,
    SAVED
  );
  const both = await Promise.all([
    checkDevice(laboran, m4, andi, true),
    checkDevice(fajarToken, m4, andi, false),
  ]);
  const bothSummary = JSON.stringify(both.map((r) => `${r.code} ${r.message}`));
  check(
    "laboran menekan Ada dan asisten menekan Tidak ada bersamaan: satu berhasil",
    both.filter((r) => r.code === 200).length === 1 &&
      both.filter((r) => r.code === 409 && r.message === ALREADY_CHECKED)
        .length === 1,
    bothSummary
  );
  const presentWon = both[0].code === 200;
  record = await recordOf(m4, andi);
  check(
    "  hasil akhir sesuai tombol yang berhasil",
    record?.status === presentWon &&
      record?.device_check === "SUDAH_DICEK" &&
      (await usualOf(andi)) ===
        JSON.stringify([presentWon ? phone.andiNew : phone.andi]),
    `${bothSummary} ${JSON.stringify(record)} ${await usualOf(andi)}`
  );
});
