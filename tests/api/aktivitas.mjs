import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, MISSING_ID, newDeviceId, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("36");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FORBIDDEN = "Hanya laboran yang dapat melihat riwayat aktivitas!";
const WIB_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const runScript = (script, args, input = "") =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn("npm", ["run", "--silent", script, "--", ...args], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });

const wibDate = (time) => new Date(time + WIB_MS).toISOString().slice(0, 10);

await runTest("Riwayat aktivitas staf", data, async () => {
  const period = data.period;
  const mine = {
    OR: [
      { actorNim: { startsWith: data.nimPrefix } },
      { targetNim: { startsWith: data.nimPrefix } },
    ],
  };
  const logs = (where = {}) =>
    db.trn_activity_logs.findMany({
      where: { AND: [mine, where] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  const total = () => db.trn_activity_logs.count({ where: mine });
  const latest = async (action) => (await logs({ action })).at(-1);
  const fields = (log, keys) =>
    log && Object.fromEntries(keys.map((key) => [key, log[key]]));
  const expectLogged = async (label, run, action, expected) => {
    const before = await total();
    const res = await run();
    const added = (await total()) - before;
    const log = await latest(action);
    const keys = Object.keys(expected);
    check(
      label,
      res.code >= 200 &&
        res.code < 300 &&
        added === 1 &&
        Boolean(log) &&
        keys.every((key) => log[key] === expected[key]),
      `${res.code} ${res.message} | baris baru ${added} | ${JSON.stringify(fields(log, keys))}`
    );
    return res;
  };
  const expectNotLogged = async (label, run, code) => {
    const before = await total();
    const res = await run();
    const added = (await total()) - before;
    check(
      label,
      res.code === code && added === 0,
      `${res.code} ${res.message} | baris baru ${added}`
    );
    return res;
  };

  const subject = await data.subject("Uji Riwayat Aktivitas");
  const classA = await data.classOf(subject, "A", "MONDAY", 1);
  const classB = await data.classOf(subject, "B", "MONDAY", 2);
  const [budi, citra, dewi, eka] = await data.students(
    4,
    (i) => ["Budi Asisten", "Citra Bayar", "Dewi Hadir", "Eka Batal"][i]
  );
  const classText = "Uji Riwayat Aktivitas kelas A";

  section("Login staf");
  let laboranToken;
  await expectLogged(
    "laboran login: tercatat Login berhasil",
    async () => {
      const res = await call("POST", "/auth/login", {
        body: { nim: data.laboran.nim, password: data.password },
      });
      laboranToken = res.json.data?.accessToken;
      return res;
    },
    "LOGIN_SUCCESS",
    {
      actorId: data.laboran.id,
      actorName: "Laboran Uji",
      actorNim: data.laboran.nim,
      actorRole: "LABORAN",
      description: `Laboran Uji (${data.laboran.nim}) · Laboran`,
      change: null,
      periodId: period.id,
    }
  );
  let dosenToken;
  await expectLogged(
    "dosen login: tercatat Login berhasil",
    async () => {
      const res = await call("POST", "/auth/login", {
        body: { nim: data.lecturer.nim, password: data.password },
      });
      dosenToken = res.json.data?.accessToken;
      return res;
    },
    "LOGIN_SUCCESS",
    {
      actorId: data.lecturer.id,
      actorRole: "DOSEN",
      description: `Dosen Uji (${data.lecturer.nim}) · Dosen`,
    }
  );
  let budiToken;
  await expectNotLogged(
    "mahasiswa login: tidak dicatat",
    async () => {
      const res = await call("POST", "/auth/login", {
        body: { nim: budi.nim, password: data.password },
      });
      budiToken = res.json.data?.accessToken;
      return res;
    },
    200
  );

  const wrong = (user) =>
    call("POST", "/auth/login", {
      body: { nim: user.nim, password: "salah-sekali" },
    });
  let before = await total();
  for (let i = 0; i < 3; i++) await wrong(data.laboran);
  const failed = await logs({
    action: "LOGIN_FAILED",
    actorId: data.laboran.id,
  });
  check(
    "3 kali password laboran salah: satu baris Login gagal berisi 3 percobaan",
    (await total()) === before + 1 &&
      failed.length === 1 &&
      failed[0].attempts === 3 &&
      failed[0].description === "Password salah" &&
      failed[0].actorRole === "LABORAN" &&
      failed[0].updatedAt !== null,
    JSON.stringify(
      failed.map((log) =>
        fields(log, ["attempts", "description", "actorRole", "updatedAt"])
      )
    )
  );
  await Promise.all(Array.from({ length: 5 }, () => wrong(data.lecturer)));
  const dosenFailed = await logs({
    action: "LOGIN_FAILED",
    actorId: data.lecturer.id,
  });
  check(
    "5 kali password dosen salah bersamaan: tetap satu baris berisi 5 percobaan",
    dosenFailed.length === 1 && dosenFailed[0].attempts === 5,
    JSON.stringify(dosenFailed.map((log) => fields(log, ["attempts"])))
  );
  await db.trn_activity_logs.update({
    where: { id: failed[0].id },
    data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
  });
  await wrong(data.laboran);
  const laterFailed = await logs({
    action: "LOGIN_FAILED",
    actorId: data.laboran.id,
  });
  check(
    "  password salah lagi setelah lewat 10 menit: baris baru",
    laterFailed.length === 2 &&
      laterFailed.some((log) => log.attempts === 3) &&
      laterFailed.some((log) => log.attempts === 1),
    JSON.stringify(laterFailed.map((log) => fields(log, ["attempts"])))
  );
  await expectNotLogged(
    "password mahasiswa salah: tidak dicatat",
    () => wrong(dewi),
    401
  );
  await expectNotLogged(
    "NIM yang tidak terdaftar: tidak dicatat",
    () =>
      call("POST", "/auth/login", {
        body: { nim: `${data.nimPrefix}999`, password: "apa-saja-1" },
      }),
    401
  );
  const citraToken = (await login(citra, data.password)).token;
  const ekaToken = (await login(eka, data.password)).token;

  section("Pembayaran");
  const citraActivation = await data.activate(citra, subject, false);
  const pay = (body) =>
    call("PUT", `/activation/${citraActivation.id}`, {
      token: laboranToken,
      body,
    });
  const citraText = `Citra Bayar (${citra.nim}) · Uji Riwayat Aktivitas`;
  await expectLogged(
    "konfirmasi bayar tanpa kelas",
    () => pay({ status: true }),
    "PAYMENT_STATUS_CHANGED",
    {
      actorId: data.laboran.id,
      actorRole: "LABORAN",
      description: citraText,
      change: "Belum Bayar → Sudah Bayar",
      targetNim: citra.nim,
      periodId: period.id,
    }
  );
  await expectNotLogged(
    "  dikonfirmasi lagi tanpa perubahan: tidak dicatat",
    () => pay({ status: true }),
    200
  );
  await expectLogged(
    "diubah ke belum bayar",
    () => pay({ status: false }),
    "PAYMENT_STATUS_CHANGED",
    { change: "Sudah Bayar → Belum Bayar" }
  );
  await expectLogged(
    "konfirmasi bayar sekaligus masuk kelas A",
    () => pay({ status: true, classId: classA.id }),
    "PAYMENT_STATUS_CHANGED",
    { change: "Belum Bayar → Sudah Bayar; masuk kelas A" }
  );
  await expectLogged(
    "pindah ke kelas B",
    () =>
      call("PUT", `/activation/${citraActivation.id}/class`, {
        token: laboranToken,
        body: { classId: classB.id },
      }),
    "STUDENT_CLASS_MOVED",
    {
      description: citraText,
      change: "kelas A → kelas B",
      targetNim: citra.nim,
    }
  );
  await expectLogged(
    "belum bayar lagi: sekaligus keluar dari kelas B",
    () => pay({ status: false }),
    "PAYMENT_STATUS_CHANGED",
    { change: "Sudah Bayar → Belum Bayar; keluar dari kelas B" }
  );
  await expectNotLogged(
    "status bukan true atau false ditolak: tidak dicatat",
    () => pay({ status: "ya" }),
    400
  );
  await expectLogged(
    "laboran menghapus pendaftaran",
    () =>
      call("DELETE", `/activation/${citraActivation.id}`, {
        token: laboranToken,
      }),
    "ACTIVATION_DELETED",
    { description: citraText, change: null, targetNim: citra.nim }
  );
  const ekaActivation = await data.activate(eka, subject, false);
  await expectNotLogged(
    "mahasiswa membatalkan pendaftarannya sendiri: tidak dicatat",
    () =>
      call("DELETE", `/activation/${ekaActivation.id}`, { token: ekaToken }),
    200
  );

  section("Asisten kelas");
  await expectLogged(
    "laboran menambah asisten",
    () =>
      call("POST", "/collaborator", {
        token: laboranToken,
        body: { classId: classA.id, collaborators: [budi.id] },
      }),
    "ASSISTANT_ADDED",
    {
      actorRole: "LABORAN",
      description: `Budi Asisten (${budi.nim}) · ${classText}`,
      targetNim: budi.nim,
      periodId: period.id,
    }
  );

  section("Pertemuan dan sesi presensi");
  await expectLogged(
    "asisten menambah pertemuan",
    () =>
      call("POST", "/meeting", {
        token: budiToken,
        body: { classId: classA.id, meetingName: "Pertemuan 1" },
      }),
    "MEETING_CREATED",
    {
      actorId: budi.id,
      actorName: "Budi Asisten",
      actorNim: budi.nim,
      actorRole: "ASISTEN",
      description: `${classText} · Pertemuan 1`,
      periodId: period.id,
    }
  );
  const meeting1 = await db.trn_meetings.findFirst({
    where: { classId: classA.id, name: "Pertemuan 1" },
  });
  await expectNotLogged(
    "  judul sama: tidak dicatat",
    () =>
      call("PUT", `/meeting/${meeting1.id}`, {
        token: budiToken,
        body: { meetingName: "Pertemuan 1" },
      }),
    200
  );
  await expectLogged(
    "asisten mengganti judul",
    () =>
      call("PUT", `/meeting/${meeting1.id}`, {
        token: budiToken,
        body: { meetingName: "Pertemuan Satu" },
      }),
    "MEETING_RENAMED",
    { description: classText, change: "Pertemuan 1 → Pertemuan Satu" }
  );
  await expectNotLogged(
    "  judul kembar ditolak: tidak dicatat",
    () =>
      call("POST", "/meeting", {
        token: budiToken,
        body: { classId: classA.id, meetingName: "pertemuan satu" },
      }),
    409
  );
  const setStatus = (token, status) =>
    call("PUT", `/meeting/${meeting1.id}/status`, { token, body: { status } });
  await expectLogged(
    "laboran membuka sesi presensi",
    () => setStatus(laboranToken, true),
    "MEETING_OPENED",
    { actorRole: "LABORAN", description: `${classText} · Pertemuan Satu` }
  );
  await expectNotLogged(
    "  dibuka lagi: tidak dicatat",
    () => setStatus(laboranToken, true),
    200
  );
  await expectLogged(
    "asisten menutup sesi presensi",
    () => setStatus(budiToken, false),
    "MEETING_CLOSED",
    { actorRole: "ASISTEN", description: `${classText} · Pertemuan Satu` }
  );
  await expectLogged(
    "laboran menambah pertemuan kedua",
    () =>
      call("POST", "/meeting", {
        token: laboranToken,
        body: { classId: classA.id, meetingName: "Pertemuan 2" },
      }),
    "MEETING_CREATED",
    { actorRole: "LABORAN", description: `${classText} · Pertemuan 2` }
  );
  const meeting2 = await db.trn_meetings.findFirst({
    where: { classId: classA.id, name: "Pertemuan 2" },
  });
  await expectLogged(
    "laboran menghapus pertemuan kedua",
    () => call("DELETE", `/meeting/${meeting2.id}`, { token: laboranToken }),
    "MEETING_DELETED",
    { description: `${classText} · Pertemuan 2` }
  );
  await expectNotLogged(
    "dosen menambah pertemuan ditolak: tidak dicatat",
    () =>
      call("POST", "/meeting", {
        token: dosenToken,
        body: { classId: classA.id, meetingName: "Pertemuan Dosen" },
      }),
    403
  );

  section("Presensi");
  await data.activate(dewi, subject, true);
  await data.enroll(dewi, classA);
  const dewiText = `Dewi Hadir (${dewi.nim}) · ${classText} · Pertemuan Satu`;
  const mark = (token, status) =>
    call("PUT", `/meeting/${meeting1.id}/attendances/${dewi.id}`, {
      token,
      body: { status },
    });
  await expectLogged(
    "asisten menandai hadir",
    () => mark(budiToken, true),
    "ATTENDANCE_SET",
    {
      actorRole: "ASISTEN",
      description: dewiText,
      change: "Belum Presensi → Hadir",
      targetNim: dewi.nim,
    }
  );
  await expectNotLogged(
    "  ditandai hadir lagi: tidak dicatat",
    () => mark(budiToken, true),
    200
  );
  await expectLogged(
    "laboran menandai tidak hadir",
    () => mark(laboranToken, false),
    "ATTENDANCE_SET",
    { actorRole: "LABORAN", change: "Hadir → Tidak Hadir" }
  );
  await expectLogged(
    "laboran menghapus catatan presensi",
    () =>
      call("DELETE", `/meeting/${meeting1.id}/attendances/${dewi.id}`, {
        token: laboranToken,
      }),
    "ATTENDANCE_RESET",
    { description: dewiText, change: "Tidak Hadir → Belum Presensi" }
  );
  const unusualScan = (meeting) =>
    db.trn_meeting_participants.create({
      data: {
        meetingId: meeting.id,
        userId: dewi.id,
        status: true,
        deviceId: newDeviceId(),
        deviceCheck: "TIDAK_BIASA",
      },
    });
  const checkDevice = (meeting, present) =>
    call("PUT", `/meeting/${meeting.id}/attendances/${dewi.id}/device`, {
      token: laboranToken,
      body: { present },
    });
  await unusualScan(meeting1);
  await expectLogged(
    "cek HP tidak biasa: Tidak ada",
    () => checkDevice(meeting1, false),
    "DEVICE_CHECKED",
    {
      description: dewiText,
      change: "Tidak ada; Hadir → Tidak Hadir",
      targetNim: dewi.nim,
    }
  );
  const meeting3 = await data.meeting(classA, "Pertemuan Tiga");
  await unusualScan(meeting3);
  await expectLogged(
    "cek HP tidak biasa: Ada",
    () => checkDevice(meeting3, true),
    "DEVICE_CHECKED",
    {
      description: `Dewi Hadir (${dewi.nim}) · ${classText} · Pertemuan Tiga`,
      change: "Ada; HP ini menjadi HP biasanya",
    }
  );
  await expectNotLogged(
    "  dicek lagi ditolak: tidak dicatat",
    () => checkDevice(meeting3, true),
    409
  );

  section("Jam sesi, kelas, dan mata kuliah");
  const used = new Set(
    (await db.mst_session.findMany({ where: { periodId: period.id } })).map(
      (session) => session.number
    )
  );
  const number = Array.from({ length: 20 }, (_, i) => 20 - i).find(
    (n) => !used.has(n)
  );
  if (!number) throw new Error("Butuh satu nomor sesi yang kosong");
  await expectLogged(
    "tambah jam sesi",
    () =>
      call("POST", "/session", {
        token: laboranToken,
        body: {
          room: "SBTI",
          day: "FRIDAY",
          number,
          startAt: "23.00",
          endAt: "23.20",
        },
      }),
    "SESSION_CREATED",
    { description: `Sesi ${number} Jumat SBTI · 23.00 - 23.20` }
  );
  const session = await db.mst_session.findFirst({
    where: { periodId: period.id, room: "SBTI", day: "FRIDAY", number },
  });
  await expectLogged(
    "ubah jam sesi",
    () =>
      call("PUT", `/session/${session.id}`, {
        token: laboranToken,
        body: { startAt: "23.05", endAt: "23.25", isActive: false },
      }),
    "SESSION_UPDATED",
    {
      description: `Sesi ${number} Jumat SBTI`,
      change: "jam 23.00 - 23.20 → 23.05 - 23.25; aktif → nonaktif",
    }
  );
  await expectNotLogged(
    "  disimpan tanpa perubahan: tidak dicatat",
    () =>
      call("PUT", `/session/${session.id}`, { token: laboranToken, body: {} }),
    200
  );
  await expectLogged(
    "hapus jam sesi",
    () => call("DELETE", `/session/${session.id}`, { token: laboranToken }),
    "SESSION_DELETED",
    { description: `Sesi ${number} Jumat SBTI · 23.05 - 23.25` }
  );

  const third = (await data.sessions())[2];
  await expectLogged(
    "tambah kelas",
    () =>
      call("POST", "/class", {
        token: laboranToken,
        body: {
          subjectId: subject.id,
          name: "C",
          quota: 30,
          day: "MONDAY",
          room: "PSI",
          sessionId: third.id,
        },
      }),
    "CLASS_CREATED",
    {
      description:
        "Uji Riwayat Aktivitas kelas C · Senin, 19.30 - 20.10 PSI · kuota 30",
      periodId: period.id,
    }
  );
  const classC = await db.mst_class.findFirst({
    where: { subjectId: subject.id, name: "C" },
  });
  await expectLogged(
    "ubah nama dan kuota kelas",
    () =>
      call("PUT", `/class/${classC.id}`, {
        token: laboranToken,
        body: { name: "D", quota: 25 },
      }),
    "CLASS_UPDATED",
    {
      description: "Uji Riwayat Aktivitas kelas D",
      change: "nama C → D; kuota 30 → 25",
    }
  );
  await expectNotLogged(
    "  disimpan tanpa perubahan: tidak dicatat",
    () =>
      call("PUT", `/class/${classC.id}`, {
        token: laboranToken,
        body: { name: "D", quota: 25 },
      }),
    200
  );
  await expectLogged(
    "hapus kelas",
    () => call("DELETE", `/class/${classC.id}`, { token: laboranToken }),
    "CLASS_DELETED",
    { description: "Uji Riwayat Aktivitas kelas D", change: null }
  );
  await expectNotLogged(
    "kelas yang sudah punya presensi tidak bisa dihapus: tidak dicatat",
    () => call("DELETE", `/class/${classA.id}`, { token: laboranToken }),
    409
  );

  const code = data.nextCode();
  await expectLogged(
    "tambah mata kuliah",
    () =>
      call("POST", "/subject", {
        token: laboranToken,
        body: {
          subjectCode: code,
          subjectName: "Uji Riwayat Baru",
          semester: "3",
          lecturerId: data.lecturer.id,
        },
      }),
    "SUBJECT_CREATED",
    {
      description: `${code} Uji Riwayat Baru · semester 3 · dosen Dosen Uji`,
      periodId: period.id,
    }
  );
  const newSubject = await db.mst_subject.findFirst({
    where: { subjectCode: code },
  });
  await expectLogged(
    "ubah semester mata kuliah",
    () =>
      call("PUT", `/subject/${newSubject.id}`, {
        token: laboranToken,
        body: { semester: "5" },
      }),
    "SUBJECT_UPDATED",
    { description: `${code} Uji Riwayat Baru`, change: "semester 3 → 5" }
  );
  await expectLogged(
    "hapus mata kuliah",
    () => call("DELETE", `/subject/${newSubject.id}`, { token: laboranToken }),
    "SUBJECT_DELETED",
    { description: `${code} Uji Riwayat Baru` }
  );

  section("Pengumuman");
  await expectLogged(
    "buat pengumuman untuk satu mata kuliah",
    () =>
      call("POST", "/announcement", {
        token: laboranToken,
        body: {
          type: "BASIC",
          title: "Uji Riwayat Pengumuman",
          body: "Isi pengumuman uji.",
          subjectIds: [subject.id],
        },
      }),
    "ANNOUNCEMENT_CREATED",
    {
      description:
        "Uji Riwayat Pengumuman · Pengumuman · untuk Uji Riwayat Aktivitas",
      periodId: period.id,
    }
  );
  const announcement = await db.mst_announcement.findFirst({
    where: { author: data.laboran.id, title: "Uji Riwayat Pengumuman" },
  });
  const edit = (body) =>
    call("PUT", `/announcement/${announcement.id}`, {
      token: laboranToken,
      body: { type: "BASIC", ...body },
    });
  await expectLogged(
    "ubah judul, isi, dan tujuan",
    () =>
      edit({
        title: "Uji Riwayat Pengumuman Baru",
        body: "Isi baru.",
        subjectIds: [],
      }),
    "ANNOUNCEMENT_UPDATED",
    {
      description: "Uji Riwayat Pengumuman Baru",
      change:
        "judul Uji Riwayat Pengumuman → Uji Riwayat Pengumuman Baru; isi diubah; tujuan untuk Uji Riwayat Aktivitas → untuk semua mahasiswa",
    }
  );
  await expectNotLogged(
    "  disimpan tanpa perubahan: tidak dicatat",
    () => edit({ title: "Uji Riwayat Pengumuman Baru", body: "Isi baru." }),
    200
  );
  await expectLogged(
    "hapus pengumuman",
    () =>
      call("DELETE", `/announcement/${announcement.id}`, {
        token: laboranToken,
      }),
    "ANNOUNCEMENT_DELETED",
    { description: "Uji Riwayat Pengumuman Baru" }
  );

  section("Akun");
  const niy = `${data.nimPrefix}8`;
  await expectLogged(
    "laboran membuat akun dosen",
    () =>
      call("POST", "/user", {
        token: laboranToken,
        body: {
          nim: niy,
          fullname: "Dosen Riwayat",
          password: "dosenriwayat1",
          role: "DOSEN",
        },
      }),
    "ACCOUNT_CREATED",
    {
      actorRole: "LABORAN",
      description: `Dosen Riwayat (${niy}) · Dosen`,
      targetNim: niy,
    }
  );
  await expectLogged(
    "laboran mengganti password dosen",
    () =>
      call("PUT", `/user/${niy}/password`, {
        token: laboranToken,
        body: { password: "dosenriwayat2" },
      }),
    "PASSWORD_RESET",
    { description: `Dosen Riwayat (${niy}) · Dosen`, targetNim: niy }
  );
  await expectNotLogged(
    "  password berspasi ditolak: tidak dicatat",
    () =>
      call("PUT", `/user/${niy}/password`, {
        token: laboranToken,
        body: { password: "dosen riwayat" },
      }),
    400
  );
  await expectLogged(
    "laboran mengganti namanya sendiri",
    () =>
      call("PUT", "/auth/me", {
        token: laboranToken,
        body: { fullname: "Laboran Uji Baru" },
      }),
    "OWN_NAME_CHANGED",
    {
      actorName: "Laboran Uji Baru",
      description: `Laboran Uji Baru (${data.laboran.nim}) · Laboran`,
      change: "Laboran Uji → Laboran Uji Baru",
    }
  );
  await expectNotLogged(
    "  nama sama: tidak dicatat",
    () =>
      call("PUT", "/auth/me", {
        token: laboranToken,
        body: { fullname: "Laboran Uji Baru" },
      }),
    200
  );
  await expectLogged(
    "dosen mengganti passwordnya sendiri",
    () =>
      call("PUT", "/auth/me/password", {
        token: dosenToken,
        body: {
          oldPassword: data.password,
          password: "dosenbaru123",
          confirmPassword: "dosenbaru123",
        },
      }),
    "OWN_PASSWORD_CHANGED",
    {
      actorRole: "DOSEN",
      description: `Dosen Uji (${data.lecturer.nim}) · Dosen`,
    }
  );
  dosenToken = (await login(data.lecturer, "dosenbaru123")).token;
  await expectNotLogged(
    "mahasiswa mengganti namanya sendiri: tidak dicatat",
    () =>
      call("PUT", "/auth/me", {
        token: citraToken,
        body: { fullname: "Citra Bayar Baru" },
      }),
    200
  );

  section("Skrip terminal");
  before = await total();
  const removed = await runScript("hapus-akun", [eka.nim], "HAPUS\n");
  const ekaLog = await latest("ACCOUNT_DELETED");
  check(
    "hapus akun mahasiswa lewat terminal tercatat",
    removed.code === 0 &&
      (await total()) === before + 1 &&
      ekaLog?.actorRole === "TERMINAL" &&
      ekaLog.actorName === "Lewat terminal" &&
      ekaLog.actorId === null &&
      ekaLog.actorNim === null &&
      ekaLog.description === `Eka Batal (${eka.nim}) · Mahasiswa` &&
      ekaLog.change === null &&
      ekaLog.targetNim === eka.nim,
    `${removed.output.slice(-160)} | ${JSON.stringify(ekaLog)}`
  );
  const pendingNim = `${data.nimPrefix}777`;
  await db.trn_registrations.create({
    data: {
      email: `uji-${pendingNim}@example.test`,
      nim: pendingNim,
      fullname: "Calon Mahasiswa",
      password: "belum-dipakai",
      code: "belum-dipakai",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      sentAt: new Date(),
    },
  });
  before = await total();
  const pending = await runScript("hapus-akun", [pendingNim], "HAPUS\n");
  const pendingLog = await latest("REGISTRATION_DELETED");
  check(
    "hapus pendaftaran yang belum diverifikasi lewat terminal tercatat",
    pending.code === 0 &&
      (await total()) === before + 1 &&
      pendingLog?.actorRole === "TERMINAL" &&
      pendingLog.description ===
        `Calon Mahasiswa (${pendingNim}) · pendaftaran belum diverifikasi` &&
      pendingLog.targetNim === pendingNim,
    `${pending.output.slice(-160)} | ${JSON.stringify(pendingLog)}`
  );
  before = await total();
  const cancelled = await runScript("hapus-akun", [citra.nim], "tidak\n");
  check(
    "  hapus akun yang dibatalkan: tidak dicatat",
    cancelled.code === 1 && (await total()) === before,
    cancelled.output.slice(-160)
  );

  section("Membaca riwayat (GET /activity)");
  const read = (query = "", token = laboranToken) =>
    call("GET", `/activity${query}`, { token });
  const counted = await total();
  const all = await read(`?q=${data.nimPrefix}`);
  const items = all.json.data?.items ?? [];
  check(
    "laboran membaca riwayat: 200, terbaru di atas",
    all.code === 200 &&
      all.message === "Berhasil" &&
      items.length === Math.min(counted, 50) &&
      items.every(
        (item, i) => i === 0 || item.createdAt <= items[i - 1].createdAt
      ),
    `${all.code} ${all.message} ${items.length}/${counted}`
  );
  check(
    "  jumlah, ukuran halaman, dan jumlah halaman",
    all.json.data?.total === counted &&
      all.json.data.page === 1 &&
      all.json.data.pageSize === 50 &&
      all.json.data.totalPages === Math.ceil(counted / 50),
    JSON.stringify({ ...all.json.data, items: undefined })
  );
  const loginRow = items.find(
    (item) =>
      item.action === "LOGIN_SUCCESS" && item.actor.id === data.lecturer.id
  );
  check(
    "  isi baris: aksi, label, kelompok, pelaku, data, perubahan, waktu",
    loginRow?.actionLabel === "Login berhasil" &&
      loginRow.group === "LOGIN" &&
      loginRow.actor.name === "Dosen Uji" &&
      loginRow.actor.nim === data.lecturer.nim &&
      loginRow.actor.role === "DOSEN" &&
      loginRow.description === `Dosen Uji (${data.lecturer.nim}) · Dosen` &&
      loginRow.change === null &&
      loginRow.attempts === 1 &&
      loginRow.periodId === period.id &&
      !Number.isNaN(Date.parse(loginRow.createdAt)) &&
      loginRow.updatedAt === null,
    JSON.stringify(loginRow)
  );
  const page2 = await read(`?q=${data.nimPrefix}&page=2`);
  check(
    "  halaman 2 berisi sisanya",
    page2.code === 200 &&
      page2.json.data.page === 2 &&
      page2.json.data.items.length === Math.max(0, counted - 50),
    `${page2.code} ${page2.json.data?.items?.length}`
  );
  const loginOnly = await read(`?group=LOGIN&q=${data.nimPrefix}`);
  const loginItems = loginOnly.json.data?.items ?? [];
  const failedRow = loginItems.find(
    (item) => item.action === "LOGIN_FAILED" && item.attempts === 3
  );
  check(
    "saring jenis Login: hanya login, login gagal membawa jumlah percobaan",
    loginOnly.code === 200 &&
      loginItems.length > 0 &&
      loginItems.every((item) => item.group === "LOGIN") &&
      failedRow?.actionLabel === "Login gagal" &&
      failedRow.updatedAt !== null,
    `${loginOnly.code} ${loginItems.map((item) => item.action)}`
  );
  const dewiRows = (await read(`?q=dewi hadir`)).json.data?.items ?? [];
  check(
    "cari nama mahasiswa (huruf kecil): 5 baris presensinya",
    dewiRows.length === 5 &&
      dewiRows.every((item) => item.description.includes(dewi.nim)),
    dewiRows.map((item) => item.action).join(", ")
  );
  const inPeriod = await read(`?periodId=${period.id}&q=${data.nimPrefix}`);
  check(
    "saring semester aktif",
    inPeriod.code === 200 &&
      inPeriod.json.data.total === counted &&
      inPeriod.json.data.items.every((item) => item.periodId === period.id),
    `${inPeriod.code} ${inPeriod.json.data?.total}/${counted}`
  );
  const firstAt = (await logs())[0].createdAt.getTime();
  const range = await read(
    `?from=${wibDate(firstAt)}&to=${wibDate(Date.now())}&q=${data.nimPrefix}`
  );
  check(
    "saring tanggal (WIB) dari catatan pertama sampai hari ini",
    range.code === 200 && range.json.data.total === counted,
    `${range.code} ${range.json.data?.total}/${counted}`
  );
  const dayBefore = wibDate(firstAt - DAY_MS);
  const empty = await read(
    `?from=${dayBefore}&to=${dayBefore}&q=${data.nimPrefix}`
  );
  check(
    "  sehari sebelumnya: kosong",
    empty.code === 200 && empty.json.data.total === 0,
    `${empty.code} ${empty.json.data?.total}`
  );
  expect("dosen ditolak", await read("", dosenToken), 403, FORBIDDEN);
  expect("mahasiswa ditolak", await read("", citraToken), 403, FORBIDDEN);
  expect(
    "tanpa login ditolak",
    await call("GET", "/activity"),
    400,
    "Silakan login terlebih dahulu!"
  );
  for (const [label, query, status, message] of [
    [
      "jenis tidak dikenal",
      "?group=LAIN",
      400,
      "Jenis aktivitas tidak dikenal!",
    ],
    [
      "jenis ganda",
      "?group=LOGIN&group=CLASS",
      400,
      "Jenis aktivitas tidak dikenal!",
    ],
    [
      "tanggal salah format",
      "?from=16-11-2026",
      400,
      "Tanggal harus berformat YYYY-MM-DD!",
    ],
    [
      "tanggal yang tidak ada",
      "?to=2026-02-30",
      400,
      "Tanggal harus berformat YYYY-MM-DD!",
    ],
    [
      "tanggal awal setelah tanggal akhir",
      "?from=2026-11-20&to=2026-11-19",
      400,
      "Tanggal awal tidak boleh setelah tanggal akhir!",
    ],
    ["halaman 0", "?page=0", 400, "Nomor halaman tidak valid!"],
    ["halaman bukan angka", "?page=dua", 400, "Nomor halaman tidak valid!"],
    [
      "halaman terlalu besar",
      "?page=1000000",
      400,
      "Nomor halaman tidak valid!",
    ],
    [
      "kata kunci 101 huruf",
      `?q=${"a".repeat(101)}`,
      400,
      "Kata kunci paling banyak 100 karakter!",
    ],
    [
      "periode tidak ada",
      `?periodId=${MISSING_ID}`,
      404,
      "Periode tidak ditemukan!",
    ],
  ])
    expect(`  ${label}`, await read(query), status, message);
  check(
    "membaca riwayat tidak menambah catatan",
    (await total()) === counted,
    `${counted} → ${await total()}`
  );

  section("Asisten dicabut");
  await expectLogged(
    "laboran menghapus asisten",
    () =>
      call("DELETE", `/collaborator/${classA.id}/${budi.id}`, {
        token: laboranToken,
      }),
    "ASSISTANT_REMOVED",
    {
      description: `Budi Asisten (${budi.nim}) · ${classText}`,
      targetNim: budi.nim,
    }
  );
  await expectNotLogged(
    "  bekas asisten membuka sesi ditolak: tidak dicatat",
    () => setStatus(budiToken, true),
    403
  );
});
