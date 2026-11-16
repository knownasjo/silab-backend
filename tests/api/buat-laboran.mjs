import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, TestData } from "../bantuan/data.mjs";
import { call, check, runTest, section } from "../bantuan/uji.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CANCELLED = "Dibatalkan, akun tidak dibuat.";
const data = new TestData("32");

const createLaboran = (lines) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn("npm", ["run", "--silent", "buat-laboran"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(lines.map((line) => `${line}\n`).join(""));
  });

await runTest("Membuat akun laboran lewat terminal", data, async () => {
  const niy = (n) => `${data.nimPrefix}${n}`;
  const password = "laboranbaru1";
  const account = (nim) => db.mst_user.findUnique({ where: { nim } });

  section("Akun laboran baru");
  const created = await createLaboran([
    niy(1),
    "  Laboran   Baru  ",
    password,
    password,
    "ya",
  ]);
  check(
    "skrip selesai dengan pesan berhasil",
    created.code === 0 &&
      created.output.includes(
        `Akun laboran Laboran Baru berhasil dibuat. Login di web dengan NIY ${niy(1)}.`
      ),
    created.output
  );
  check(
    "  tidak menanyakan email, konfirmasi hanya menyebut nama dan NIY",
    !/email/i.test(created.output) &&
      created.output.includes(
        `Buat akun laboran Laboran Baru (NIY ${niy(1)})? (ya/tidak): `
      ),
    created.output
  );
  const user = await account(niy(1));
  check(
    "  tersimpan sebagai LABORAN tanpa email, nama dirapikan",
    user?.role === "LABORAN" &&
      user.fullname === "Laboran Baru" &&
      user.email === null,
    JSON.stringify(user && { ...user, password: undefined })
  );
  check(
    "  password tidak tampil di layar",
    !created.output.includes(password),
    created.output
  );
  const login = await call("POST", "/auth/login", {
    body: { nim: niy(1), password },
  });
  check(
    "  langsung bisa login",
    login.code === 200 && !!login.json.data?.accessToken,
    `${login.code} ${login.message}`
  );
  const createdLogs = await db.trn_activity_logs.findMany({
    where: { action: "ACCOUNT_CREATED", targetNim: niy(1) },
  });
  check(
    "  riwayat aktivitas mencatat akun dibuat lewat terminal",
    createdLogs.length === 1 &&
      createdLogs[0].actorRole === "TERMINAL" &&
      createdLogs[0].actorName === "Lewat terminal" &&
      createdLogs[0].actorId === null &&
      createdLogs[0].description === `Laboran Baru (${niy(1)}) · Laboran`,
    JSON.stringify(createdLogs)
  );

  section("Isian ditolak, akun tidak dibuat");
  for (const [label, lines, message] of [
    [
      "NIY bukan 8 angka",
      [data.nimPrefix, "Laboran Dua"],
      "NIY harus 8 angka!",
    ],
    [
      "nama kurang dari 3 huruf",
      [niy(2), "Lb"],
      "Nama lengkap harus 3 sampai 100 karakter!",
    ],
    ["NIY sudah terdaftar", [niy(1), "Laboran Dua"], "NIY sudah terdaftar!"],
    [
      "password kurang dari 8 karakter",
      [niy(2), "Laboran Dua", "pendek"],
      "Password minimal 8 karakter.",
    ],
    [
      "password berspasi",
      [niy(2), "Laboran Dua", "laboran dua"],
      "Password tidak boleh mengandung spasi.",
    ],
    [
      "ulangan password berbeda",
      [niy(2), "Laboran Dua", password, "laboranlain1"],
      "Password tidak sama.",
    ],
    [
      "konfirmasi bukan ya",
      [niy(2), "Laboran Dua", password, password, "tidak"],
      "",
    ],
  ]) {
    const res = await createLaboran(lines);
    check(
      label,
      res.code === 1 && res.output.includes(`${message} ${CANCELLED}`.trim()),
      res.output.slice(-160)
    );
  }
  check("  tidak ada akun yang ikut dibuat", (await account(niy(2))) === null);
  check(
    "  tidak ada catatan aktivitas untuk akun yang batal dibuat",
    (await db.trn_activity_logs.count({
      where: {
        action: "ACCOUNT_CREATED",
        targetNim: { startsWith: data.nimPrefix },
      },
    })) === 1
  );
});
