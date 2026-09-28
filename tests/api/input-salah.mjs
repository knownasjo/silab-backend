import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import { call, check, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("14");
const WORKERS = 8;

const ROUTES = [
  ["POST", "/auth/login", null, ["nim", "password"]],
  ["POST", "/auth/refresh", null, ["refreshToken"]],
  [
    "POST",
    "/auth/register",
    null,
    ["fullname", "email", "password", "confirmPassword"],
  ],
  ["POST", "/auth/register/verify", null, ["email", "code"]],
  ["POST", "/auth/register/resend", null, ["email"]],
  ["POST", "/auth/password/forgot", null, ["email"]],
  [
    "POST",
    "/auth/password/reset",
    null,
    ["email", "code", "password", "confirmPassword"],
  ],
  ["GET", "/auth/me", "student"],
  ["PUT", "/auth/me", "student", ["fullname"]],
  [
    "PUT",
    "/auth/me/password",
    "student",
    ["oldPassword", "password", "confirmPassword"],
  ],
  ["POST", "/activation", "student", ["subjectIds"]],
  ["GET", "/activation", "student"],
  ["GET", "/activation", "laboran"],
  ["PUT", "/activation/:activation", "laboran", ["classId", "status"]],
  ["PUT", "/activation/:activation/class", "laboran", ["classId"]],
  ["POST", "/announcement", "laboran", ["type", "title", "body"]],
  ["GET", "/announcement", "student"],
  ["GET", "/announcement/:announcement", "student"],
  ["PUT", "/announcement/:announcement", "laboran", ["type", "title", "body"]],
  ["DELETE", "/announcement/:none", "laboran"],
  [
    "POST",
    "/subject/classes/:class/meetings/:meeting/attendances",
    "student",
    ["token"],
  ],
  [
    "POST",
    "/class",
    "laboran",
    ["subjectId", "name", "quota", "day", "room", "sessionId"],
  ],
  ["GET", "/class", "laboran"],
  ["GET", "/class", "student"],
  ["GET", "/class/registration", "student"],
  ["POST", "/class/registration", "student", ["classIds"]],
  ["GET", "/class/me", "student"],
  ["GET", "/class/:class", "laboran"],
  ["GET", "/class/:class", "student"],
  [
    "PUT",
    "/class/:class",
    "laboran",
    ["subjectId", "name", "quota", "day", "room", "sessionId"],
  ],
  ["DELETE", "/class/:none", "laboran"],
  ["GET", "/class/:class/classmates", "student"],
  ["POST", "/collaborator", "laboran", ["classId", "collaborators"]],
  ["GET", "/collaborator/:class", "laboran"],
  ["DELETE", "/collaborator/:none/:none", "laboran"],
  ["GET", "/dashboard/dosen", "laboran"],
  ["POST", "/meeting", "laboran", ["classId", "meetingName"]],
  ["GET", "/meeting/:class", "student"],
  ["GET", "/meeting/:meeting/qr", "laboran"],
  ["PUT", "/meeting/:meeting", "laboran", ["meetingName"]],
  ["DELETE", "/meeting/:none", "laboran"],
  ["PUT", "/meeting/:meeting/status", "laboran", ["status"]],
  ["PUT", "/meeting/:meeting/attendances/:student", "laboran", ["status"]],
  ["DELETE", "/meeting/:none/attendances/:none", "laboran"],
  ["GET", "/session", "student"],
  ["GET", "/period", "student"],
  [
    "POST",
    "/session",
    "laboran",
    ["day_group", "number", "startAt", "endAt", "is_active"],
  ],
  [
    "PUT",
    "/session/:session",
    "laboran",
    ["day_group", "number", "startAt", "endAt", "is_active"],
  ],
  ["DELETE", "/session/:none", "laboran"],
  [
    "POST",
    "/subject",
    "laboran",
    ["subject_code", "subject_name", "semester", "lecturer_id"],
  ],
  ["GET", "/subject", "student"],
  ["GET", "/subject/:subject", "student"],
  [
    "PUT",
    "/subject/:subject",
    "laboran",
    ["subject_code", "subject_name", "semester", "lecturer_id"],
  ],
  [
    "POST",
    "/user",
    "laboran",
    ["email", "nim", "fullname", "password", "role"],
  ],
  ["GET", "/user/dosen", "laboran"],
  ["GET", "/user/mahasiswa", "laboran"],
  ["PUT", "/user/:nim/password", "laboran", ["password"]],
];

const variantsFor = (fields) => {
  const fill = (value) =>
    Object.fromEntries(fields.map((field) => [field, value]));
  return [
    ["isian kosong {}", { body: {} }],
    ["field berisi objek", { body: fill({}) }],
    ["field berisi angka", { body: fill(12345) }],
    ["field berisi array angka", { body: fill([1]) }],
    ["field berisi array objek", { body: fill([{}]) }],
    ["field berisi null", { body: fill(null) }],
    ["field berisi teks kosong", { body: fill("") }],
    ["field berisi teks sangat panjang", { body: fill("x".repeat(5000)) }],
    ["body berupa array", { body: [] }],
    ["tanpa body", {}],
    ["body teks biasa", { raw: "halo" }],
  ];
};

await runTest("Input acak dan keliru ke semua endpoint", data, async () => {
  const subject = await data.subject("Uji Input Salah");
  const [session] = await data.sessions();
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const student = await data.student();
  const activation = await data.activate(student, subject, true);
  await data.enroll(student, cls);
  const meeting = await data.meeting(cls, "Pertemuan Uji Input", {
    status: true,
  });
  const announcement = await db.mst_announcement.create({
    data: {
      type: "BASIC",
      title: "Uji Input Salah",
      body: "sementara",
      author: data.laboran.id,
    },
  });
  const tokens = {
    laboran: (await login(data.laboran, data.password)).token,
    student: (await login(student, data.password)).token,
  };
  const ids = {
    activation: activation.id,
    announcement: announcement.id,
    class: cls.id,
    meeting: meeting.id,
    session: session.id,
    subject: subject.id,
    student: student.id,
    nim: student.nim,
    none: MISSING_ID,
  };
  const fillPath = (path, pick) =>
    path.replace(/:(\w+)/g, (_, key) => pick(key));

  const jobs = [];
  for (const [method, path, role, fields] of ROUTES) {
    const token = tokens[role];
    const pathVariants = path.includes(":")
      ? [
          ["id asli", fillPath(path, (key) => ids[key])],
          ["id tidak ada", fillPath(path, () => MISSING_ID)],
          ["id format salah", fillPath(path, () => "bukan-id")],
        ]
      : [["", path]];
    for (const [idLabel, realPath] of pathVariants) {
      if (method === "GET" || method === "DELETE") {
        jobs.push({
          method,
          route: path,
          label: idLabel || "biasa",
          path: realPath,
          token,
        });
        continue;
      }
      for (const [label, variant] of variantsFor(fields)) {
        if (idLabel && idLabel !== "id asli" && label !== "isian kosong {}")
          continue;
        jobs.push({
          method,
          route: path,
          label: [idLabel, label].filter(Boolean).join(", "),
          path: realPath,
          token,
          ...variant,
        });
      }
    }
    if (role === "laboran" && method !== "GET")
      jobs.push({
        method,
        route: path,
        label: "oleh mahasiswa (bukan haknya)",
        path: fillPath(path, (key) => ids[key]),
        token: tokens.student,
        body: {},
      });
  }
  jobs.push({
    method: "GET",
    route: "/tidak-ada",
    label: "alamat tidak dikenal",
    path: "/tidak-ada",
    token: tokens.laboran,
  });
  jobs.push({
    method: "POST",
    route: "/auth/login",
    label: "isi 200 KB",
    path: "/auth/login",
    body: { nim: "x".repeat(200000), password: "x" },
  });
  jobs.push({
    method: "POST",
    route: "/auth/login",
    label: "JSON rusak",
    path: "/auth/login",
    raw: "{nim:",
    contentType: "application/json",
  });

  section(`Mengirim ${jobs.length} permintaan (${WORKERS} sekaligus)`);
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const { method, path, token, body, raw, contentType } = job;
        results.push({
          ...job,
          ...(await call(method, path, {
            token,
            body,
            raw,
            contentType,
            timeout: 30000,
          })),
        });
      }
    })
  );

  const codes = results.reduce(
    (all, r) => ({ ...all, [r.code]: (all[r.code] ?? 0) + 1 }),
    {}
  );
  console.log(
    `kode status: ${Object.entries(codes)
      .map(([code, n]) => `${code}=${n}`)
      .join(" ")}`
  );
  const describe = (list) =>
    list
      .slice(0, 10)
      .map((r) => `${r.method} ${r.route} [${r.label}] ${r.code} ${r.message}`)
      .join(" | ");
  const serverErrors = results.filter((r) => r.code >= 500);
  const unanswered = results.filter((r) => r.code === 0);
  const notJson = results.filter((r) => r.code !== 0 && !r.isJson);
  check(
    "semua permintaan terkirim",
    results.length === jobs.length,
    `${results.length}/${jobs.length}`
  );
  check(
    "tidak ada error server (5xx)",
    serverErrors.length === 0,
    describe(serverErrors)
  );
  check(
    "semua dijawab dalam 30 detik",
    unanswered.length === 0,
    describe(unanswered)
  );
  check("semua balasan berupa JSON", notJson.length === 0, describe(notJson));

  const accepted = results.filter(
    (r) =>
      r.code >= 200 && r.code < 300 && r.method !== "GET" && r.label !== "biasa"
  );
  if (accepted.length) {
    console.log(
      `\nCatatan: ${accepted.length} input keliru diterima server (bukan kegagalan, periksa bila perlu):`
    );
    for (const r of accepted)
      console.log(
        `  ${r.method} ${r.route} [${r.label}] -> ${r.code} ${r.message}`
      );
  }
});
