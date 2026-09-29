import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  db,
  newDeviceId,
  snapshotRealData,
  TestData,
} from "../bantuan/data.mjs";
import {
  API,
  call,
  check,
  ensureBackend,
  finish,
  listenEvents,
  login,
  sleep,
} from "../bantuan/uji.mjs";

const STUDENTS = Number(process.env.STUDENTS ?? 120);
const SCENARIOS = (
  process.env.SCENARIOS ?? "rebutan,tersebar,bertahap,scan"
).split(",");
const SPREAD_MS = Number(process.env.SPREAD_MS ?? 60000);
const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const LABEL =
  process.env.LABEL ??
  `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}-${pad(today.getHours())}${pad(today.getMinutes())}`;
const QUOTA = 30;
const CLASSES = 4;
const SCANNERS = Math.min(60, STUDENTS);
const PHONE_TIMEOUT_MS = 20000;
const OUT_DIR = fileURLToPath(new URL("../hasil/", import.meta.url));

if (!Number.isInteger(STUDENTS) || STUDENTS < 2 || STUDENTS > 999) {
  console.error("STUDENTS harus angka 2 sampai 999.");
  process.exit(1);
}

const data = new TestData("90");
const pct = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
};
const fmt = (ms) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} dtk` : `${Math.round(ms)} ms`;
let seed = 20260927;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const RAW_PRISMA = "[pesan mentah Prisma]";
const shortMessage = (message = "") => {
  if (message.includes("Timed out fetching a new connection"))
    return `${RAW_PRISMA} antre koneksi database habis waktu`;
  if (message.includes("Transaction"))
    return `${RAW_PRISMA} ${message.split("\n").filter(Boolean).pop().trim().slice(0, 90)}`;
  return message.split("\n")[0].slice(0, 100);
};

let phase = "persiapan";
let pending = 0;
let lastActivity = Date.now();
const records = [];
const cpuSamples = [];

const timed = async (method, path, token, body, timeout) => {
  const startPhase = phase;
  const res = await call(method, path, { token, body, timeout });
  return {
    ...res,
    phase: startPhase,
    message: res.timedOut ? "HP menyerah (lewat 20 dtk)" : res.message,
  };
};

const record = (label, res, auto = false) =>
  records.push({
    phase: res.phase,
    label,
    auto,
    code: res.code,
    ms: res.ms,
    end: Date.now(),
    timedOut: !!res.timedOut,
    message: shortMessage(res.message),
  });

class Phone {
  constructor(user) {
    this.user = user;
    this.running = {};
    this.options = [];
    this.assisted = [];
    this.profileLoaded = false;
    this.meetingsClassId = null;
    this.streams = [];
    this.deviceId = newDeviceId();
  }

  async login() {
    const res = await timed("POST", "/auth/login", null, {
      nim: this.user.nim,
      password: data.password,
      device_id: this.deviceId,
    });
    record("POST /auth/login", res);
    this.token = res.json.data?.accessToken;
    return this.token;
  }

  setOptions(res) {
    if (res.code === 200)
      this.options = (res.json.data ?? []).map((option) => option.id);
  }

  async loadOptions() {
    const res = await timed("GET", "/class/registration", this.token);
    record("GET /class/registration", res);
    this.setOptions(res);
  }

  async loadProfile() {
    const res = await timed("GET", "/class", this.token);
    record("GET /class (kelas asisten)", res);
    this.profileLoaded = res.code === 200;
    if (this.profileLoaded)
      this.assisted = (res.json.data ?? []).map((c) => c.id);
  }

  refresh(screen, label, path, after) {
    const state = (this.running[screen] ??= { busy: false, again: false });
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    pending++;
    (async () => {
      do {
        state.again = false;
        const res = await timed("GET", path, this.token);
        record(label, res, true);
        after?.(res);
      } while (state.again);
      state.busy = false;
      pending--;
      lastActivity = Date.now();
    })();
  }

  onEvent(type, payload) {
    lastActivity = Date.now();
    if (type === "class") {
      if (
        payload.action === "created" ||
        this.options.includes(payload.class_id)
      )
        this.refresh(
          "options",
          "GET /class/registration",
          "/class/registration",
          (res) => this.setOptions(res)
        );
      if (
        this.profileLoaded &&
        (payload.action === "assistants" ||
          this.assisted.includes(payload.class_id))
      )
        this.refresh("assisted", "GET /class (kelas asisten)", "/class");
    }
    if (type === "activation") {
      this.refresh("selected", "GET /activation", "/activation");
      this.refresh(
        "options",
        "GET /class/registration",
        "/class/registration",
        (res) => this.setOptions(res)
      );
      this.refresh("registered", "GET /class/me", "/class/me");
      this.refresh("schedule", "GET /class/me", "/class/me");
    }
    if (
      (type === "meeting" || type === "attendance") &&
      this.meetingsClassId &&
      payload.class_id === this.meetingsClassId
    )
      this.refresh(
        "meetings",
        "GET /meeting/:classId",
        `/meeting/${this.meetingsClassId}`
      );
  }

  async openStream() {
    this.streams.at(-1)?.close();
    this.streams.push(
      await listenEvents(this.token, (type, payload) =>
        this.onEvent(type, payload)
      )
    );
  }

  close() {
    this.streams.at(-1)?.close();
  }
}

const serverPid = (() => {
  const { hostname, port } = new URL(API);
  if (!["localhost", "127.0.0.1"].includes(hostname)) return null;
  try {
    return execFileSync("lsof", [
      "-nP",
      `-iTCP:${port || 80}`,
      "-sTCP:LISTEN",
      "-t",
    ])
      .toString()
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
})();
const cpuSeconds = (text) => {
  const parts = text.trim().split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
};
let lastCpu = null;
const sampler = setInterval(() => {
  if (!serverPid) return;
  execFile("ps", ["-o", "time=,rss=", "-p", serverPid], (error, out) => {
    if (error) return;
    const [time, rss] = out.trim().split(/\s+/);
    const now = Date.now();
    const used = cpuSeconds(time);
    if (lastCpu)
      cpuSamples.push({
        phase,
        cpu: ((used - lastCpu.used) / ((now - lastCpu.now) / 1000)) * 100,
        rssMb: Number(rss) / 1024,
      });
    lastCpu = { used, now };
  });
}, 1000);

const waitDrain = async (timeoutMs = 900000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pending === 0 && Date.now() - lastActivity > 3000) return true;
    await sleep(200);
  }
  return false;
};

const summaries = [];
const summarize = (title, startedAt, extra = {}) => {
  const rows = records.filter((r) => r.phase === phase);
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.auto ? "otomatis" : "langsung"}|${r.label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const endpoints = [...groups.entries()].map(([key, list]) => {
    const [kind, label] = key.split("|");
    const ms = list.map((r) => r.ms);
    const outcomes = {};
    for (const r of list) {
      const outcome = `${r.code} ${r.message}`.trim();
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return {
      kind,
      label,
      count: list.length,
      p50: pct(ms, 50),
      p95: pct(ms, 95),
      max: Math.max(...ms),
      overPhoneTimeout: ms.filter((v) => v > PHONE_TIMEOUT_MS).length,
      outcomes,
    };
  });
  const cpu = cpuSamples.filter((s) => s.phase === phase);
  const auto = rows.filter((r) => r.auto);
  const summary = {
    title,
    wallMs: Math.max(...rows.map((r) => r.end), startedAt) - startedAt,
    autoRequests: auto.length,
    autoFailed: auto.filter((r) => r.code !== 200).length,
    busy: rows.filter((r) => r.code === 503).length,
    serverErrors: rows.filter(
      (r) => (r.code === 0 && !r.timedOut) || (r.code >= 500 && r.code !== 503)
    ).length,
    leakedErrors: rows.filter((r) => r.message.startsWith(RAW_PRISMA)).length,
    cpuPeak: cpu.length ? Math.max(...cpu.map((s) => s.cpu)) : null,
    cpuAvg: cpu.length
      ? cpu.reduce((sum, s) => sum + s.cpu, 0) / cpu.length
      : null,
    rssPeakMb: cpu.length ? Math.max(...cpu.map((s) => s.rssMb)) : null,
    endpoints,
    ...extra,
  };
  summaries.push(summary);

  console.log(`\n== ${title}`);
  for (const e of endpoints) {
    const late = e.overPhoneTimeout
      ? ` | ${e.overPhoneTimeout}x lewat 20 dtk`
      : "";
    console.log(
      `  [${e.kind}] ${e.label}: ${e.count}x | median ${fmt(e.p50)} | 95% ${fmt(e.p95)} | terlama ${fmt(e.max)}${late}`
    );
    for (const [outcome, n] of Object.entries(e.outcomes))
      console.log(`      ${n}x ${outcome}`);
  }
  console.log(
    `  permintaan otomatis dari sinyal real-time: ${summary.autoRequests} (gagal ${summary.autoFailed})`
  );
  console.log(`  semua selesai dalam: ${fmt(summary.wallMs)}`);
  console.log(`  dibalas "server sibuk" (503): ${summary.busy}`);
  if (summary.cpuPeak !== null)
    console.log(
      `  CPU server: puncak ${Math.round(summary.cpuPeak)}%, rata-rata ${Math.round(summary.cpuAvg)}% | memori puncak ${Math.round(summary.rssPeakMb)} MB`
    );
  for (const [key, value] of Object.entries(extra))
    console.log(`  ${key}: ${value}`);
  check(
    `  tidak ada error server (500) atau koneksi putus`,
    summary.serverErrors === 0,
    summary.serverErrors
  );
  check(
    `  tidak ada pesan error mentah yang bocor ke HP`,
    summary.leakedErrors === 0,
    summary.leakedErrors
  );
  return summary;
};

console.log(
  `== Uji beban: ${STUDENTS} mahasiswa | skenario: ${SCENARIOS.join(", ")}`
);
await ensureBackend();
const realBefore = await snapshotRealData();
const phones = [];
let staff;

try {
  await data.start();
  const rtt = [];
  for (let i = 0; i < 11; i++) {
    const started = performance.now();
    await db.$queryRaw`SELECT 1`;
    rtt.push(performance.now() - started);
  }
  console.log(
    `Bolak-balik ke database dari mesin ini (median): ${fmt(pct(rtt.slice(1), 50))}`
  );
  console.log(
    `Pemantauan CPU server: ${serverPid ? `proses ${serverPid}` : "tidak tersedia (backend bukan di mesin ini)"}`
  );

  const rushSubject = await data.subject("Uji Beban Daftar");
  const scanSubject = await data.subject("Uji Beban Presensi");
  const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"];
  const rush = [];
  for (const [index, day] of days.entries())
    rush.push(
      await data.classOf(rushSubject, "ABCD"[index], day, 2, { quota: QUOTA })
    );
  const scanX = await data.classOf(scanSubject, "X", "MONDAY", 4, {
    quota: QUOTA,
  });
  const scanY = await data.classOf(scanSubject, "Y", "MONDAY", 4, {
    room: "SBTI",
    quota: QUOTA,
  });

  const users = await data.students(STUDENTS, (i) => `Uji Beban ${i + 1}`);
  await db.trn_activations.createMany({
    data: [
      ...users.map((u) => ({
        userId: u.id,
        subjectId: rushSubject.id,
        periodId: data.period.id,
        status: true,
      })),
      ...users.slice(0, SCANNERS).map((u) => ({
        userId: u.id,
        subjectId: scanSubject.id,
        periodId: data.period.id,
        status: true,
      })),
    ],
  });
  await db.trn_class_participants.createMany({
    data: users.slice(0, SCANNERS).map((u, i) => ({
      userId: u.id,
      classId: i < SCANNERS / 2 ? scanX.id : scanY.id,
    })),
  });
  const meetingX = await data.meeting(scanX, "Pertemuan Uji Beban", {
    status: true,
  });
  const meetingY = await data.meeting(scanY, "Pertemuan Uji Beban", {
    status: true,
  });
  console.log(
    `Data uji siap: ${users.length} mahasiswa, ${CLASSES} kelas pilihan (kuota ${QUOTA}), 2 kelas presensi`
  );

  phase = "buka";
  let t0 = Date.now();
  users.forEach((user) => phones.push(new Phone(user)));
  await Promise.all(phones.map((p) => p.login()));
  const noToken = phones.filter((p) => !p.token).length;
  if (noToken) throw new Error(`${noToken} mahasiswa gagal login`);
  await Promise.all(phones.map((p) => p.openStream()));
  const staffLogin = async () => {
    staff?.close();
    staff = await listenEvents(
      (await login(data.laboran, data.password)).token,
      () => {}
    );
  };
  await staffLogin();
  await Promise.all(
    phones.map((p) => Promise.all([p.loadOptions(), p.loadProfile()]))
  );
  summarize(
    `Buka aplikasi: ${STUDENTS} login lalu membuka layar pilih kelas dan profil bersamaan`,
    t0,
    {
      "koneksi real-time terbuka": `${phones.length} mahasiswa + 1 laboran`,
    }
  );

  const register = async (phone, classId, timeout) => {
    const res = await timed(
      "POST",
      "/class/registration",
      phone.token,
      { classIds: [classId] },
      timeout
    );
    record("POST /class/registration", res);
    return res;
  };
  const renewSessions = async () => {
    phase = "reset";
    await Promise.all(
      phones.map(async (p) => {
        await p.login();
        await p.openStream();
      })
    );
    await staffLogin();
  };
  const countRush = () =>
    Promise.all(
      rush.map((c) =>
        db.trn_class_participants.count({
          where: { classId: c.id, deleted_at: null },
        })
      )
    );
  const resetRush = async () => {
    await waitDrain();
    await renewSessions();
    await db.trn_class_participants.deleteMany({
      where: { classId: { in: rush.map((c) => c.id) } },
    });
    await Promise.all(phones.map((p) => p.loadOptions()));
  };
  const seats = Math.min(STUDENTS, QUOTA * CLASSES);
  const checkBurst = (results, counts) => {
    const wins = results.filter((r) => r.code === 201).length;
    const seated = counts.reduce((sum, n) => sum + n, 0);
    const unclear = results.filter(
      (r) =>
        r.code !== 201 &&
        r.code !== 503 &&
        !(r.code === 409 && r.message.includes("penuh"))
    );
    check(
      `  ${wins} dibalas berhasil dan ${seated} tercatat di kelas, tidak ada kelas melebihi kuota`,
      seated === wins && counts.every((n) => n <= QUOTA),
      counts.join("/")
    );
    check(
      "  setiap mahasiswa mendapat jawaban jelas: berhasil, kelas penuh, atau server sibuk",
      unclear.length === 0,
      unclear
        .slice(0, 5)
        .map((r) => `${r.code} ${r.message}`)
        .join(" | ")
    );
  };

  if (SCENARIOS.includes("rebutan")) {
    await resetRush();
    phase = "rebutan";
    t0 = Date.now();
    const results = await Promise.all(
      phones.map((p) => register(p, rush[0].id))
    );
    const drained = await waitDrain();
    const counts = await countRush();
    summarize(
      `Rebutan: ${STUDENTS} mahasiswa memilih kelas A (kuota ${QUOTA}) di detik yang sama`,
      t0,
      {
        "isi kelas A": counts[0],
      }
    );
    checkBurst(results, counts);
    check("  antrean pembaruan real-time tuntas", drained);
  }

  if (SCENARIOS.includes("tersebar")) {
    await resetRush();
    phase = "tersebar";
    t0 = Date.now();
    const results = await Promise.all(
      phones.map((p, i) => register(p, rush[i % CLASSES].id))
    );
    const drained = await waitDrain();
    const counts = await countRush();
    summarize(
      `Tersebar: ${STUDENTS} mahasiswa memilih kelas A/B/C/D merata di detik yang sama`,
      t0,
      {
        "isi kelas A/B/C/D": counts.join("/"),
      }
    );
    checkBurst(results, counts);
    check("  antrean pembaruan real-time tuntas", drained);
  }

  if (SCENARIOS.includes("bertahap")) {
    await resetRush();
    phase = "bertahap";
    const plans = phones.map(() => ({
      delay: rand() * SPREAD_MS,
      order:
        rand() < 0.5 ? [rush[0], ...shuffle(rush.slice(1))] : shuffle(rush),
    }));
    t0 = Date.now();
    const results = await Promise.all(
      phones.map(async (phone, i) => {
        await sleep(plans[i].delay);
        const began = performance.now();
        let attempts = 0;
        let failures = 0;
        for (const target of plans[i].order) {
          for (let tries = 0; tries < 3; tries++) {
            attempts++;
            const res = await register(phone, target.id, PHONE_TIMEOUT_MS);
            if (
              res.code === 201 ||
              (res.code === 409 && res.message.includes("sudah terdaftar"))
            )
              return {
                ok: true,
                attempts,
                failures,
                ms: performance.now() - began,
              };
            if (res.code === 409 && res.message.includes("penuh")) break;
            failures++;
            await sleep(3000);
          }
          await sleep(3000);
        }
        return { ok: false, attempts, failures, ms: performance.now() - began };
      })
    );
    const drained = await waitDrain();
    const spread = await countRush();
    const enrolled = results.filter((r) => r.ok);
    const times = enrolled.map((r) => r.ms);
    summarize(
      `Bertahap: ${STUDENTS} mahasiswa datang acak dalam ${SPREAD_MS / 1000} dtk, separuh mengincar kelas A, yang kehabisan pindah kelas`,
      t0,
      {
        "waktu sampai dapat kelas": `median ${fmt(pct(times, 50))} | 95% ${fmt(pct(times, 95))} | terlama ${fmt(Math.max(0, ...times))}`,
        "percobaan per mahasiswa": `median ${pct(
          results.map((r) => r.attempts),
          50
        )} | terbanyak ${Math.max(...results.map((r) => r.attempts))}`,
        "mahasiswa yang pernah melihat error atau timeout": results.filter(
          (r) => r.failures > 0
        ).length,
        "isi kelas A/B/C/D": spread.join("/"),
      }
    );
    check(
      `  ${enrolled.length} dari ${STUDENTS} mahasiswa dapat kelas (kursi ${seats})`,
      enrolled.length === seats
    );
    check("  antrean pembaruan real-time tuntas", drained);
  }

  if (SCENARIOS.includes("scan")) {
    await waitDrain();
    await renewSessions();
    phase = "persiapan-scan";
    const scanners = phones.slice(0, SCANNERS);
    scanners.forEach(
      (p, i) => (p.meetingsClassId = i < SCANNERS / 2 ? scanX.id : scanY.id)
    );
    await Promise.all(
      scanners.map((p) =>
        timed("GET", `/meeting/${p.meetingsClassId}`, p.token)
      )
    );
    const staffToken = (await login(data.laboran, data.password)).token;
    const qrX = (
      await call("GET", `/meeting/${meetingX.id}/qr`, { token: staffToken })
    ).json.data?.token;
    const qrY = (
      await call("GET", `/meeting/${meetingY.id}/qr`, { token: staffToken })
    ).json.data?.token;
    if (!qrX || !qrY) throw new Error("token QR tidak didapat");
    phase = "scan";
    t0 = Date.now();
    await Promise.all(
      scanners.map(async (p, i) => {
        const [cls, meeting, token] =
          i < SCANNERS / 2 ? [scanX, meetingX, qrX] : [scanY, meetingY, qrY];
        const res = await timed(
          "POST",
          `/subject/classes/${cls.id}/meetings/${meeting.id}/attendances`,
          p.token,
          { token, device_id: p.deviceId }
        );
        record("POST presensi (scan QR)", res);
      })
    );
    const drained = await waitDrain();
    const attended = await db.trn_meeting_participants.count({
      where: { meetingId: { in: [meetingX.id, meetingY.id] } },
    });
    summarize(
      `Scan QR: ${SCANNERS} mahasiswa di 2 kelas scan di detik yang sama`,
      t0,
      {
        "presensi tercatat": attended,
      }
    );
    check(`  presensi tercatat ${SCANNERS}`, attended === SCANNERS, attended);
    check("  antrean pembaruan real-time tuntas", drained);
  }

  const dropped = phones
    .flatMap((p) => p.streams)
    .filter((s) => s.dropped).length;
  console.log("");
  check(
    "koneksi real-time tidak ada yang diputus server",
    dropped === 0,
    dropped
  );
} catch (error) {
  check(
    "uji beban berjalan sampai selesai",
    false,
    error.stack ?? error.message
  );
} finally {
  clearInterval(sampler);
  phones.forEach((p) => p.close());
  staff?.close();
  await waitDrain(120000);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}uji-beban-${LABEL}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        label: LABEL,
        api: API,
        students: STUDENTS,
        at: new Date().toISOString(),
        summaries,
      },
      null,
      2
    )
  );
  console.log(`\nHasil lengkap disimpan di ${file}`);
  await finish(data, realBefore);
}
