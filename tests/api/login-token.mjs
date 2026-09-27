import { db, jwt, MISSING_ID, TestData } from "../bantuan/data.mjs";
import {
  API,
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("11");
const INVALID = "Token tidak valid, silakan login ulang!";
const NO_TOKEN = "Silakan login terlebih dahulu!";
const now = () => Math.floor(Date.now() / 1000);

await runTest("Login dan token", data, async () => {
  const student = await data.student();

  section("Login");
  const loggedIn = await call("POST", "/auth/login", {
    body: { nim: data.laboran.nim, password: data.password },
  });
  expect("login benar: Login berhasil", loggedIn, 200, "Login berhasil");
  check(
    "  membawa access token dan refresh token",
    !!loggedIn.json.data?.accessToken && !!loggedIn.json.data?.refreshToken
  );
  expect(
    "password salah ditolak",
    await call("POST", "/auth/login", {
      body: { nim: data.laboran.nim, password: "salahsalah" },
    }),
    401,
    "NIM/NIY atau password salah!"
  );
  expect(
    "NIM tidak terdaftar ditolak dengan pesan yang sama",
    await call("POST", "/auth/login", {
      body: { nim: `${data.nimPrefix}999`, password: "salahsalah" },
    }),
    401,
    "NIM/NIY atau password salah!"
  );
  expect(
    "NIM kosong ditolak",
    await call("POST", "/auth/login", { body: { nim: " ", password: "x" } }),
    400,
    "NIM/NIY dan password wajib diisi!"
  );
  const { accessToken: token, refreshToken } = loggedIn.json.data;
  expect(
    "refresh token menghasilkan token baru",
    await call("POST", "/auth/refresh", { body: { refreshToken } }),
    200,
    "Token berhasil diperbarui"
  );

  section("Token di setiap permintaan");
  expect("tanpa token", await call("GET", "/class"), 400, NO_TOKEN);
  expect("token sah", await call("GET", "/class", { token }), 200);
  expect(
    "token rusak (bukan JWT)",
    await call("GET", "/class", { token: "rusak.sekali.token" }),
    400,
    INVALID
  );
  expect(
    "header tanpa kata Bearer",
    await call("GET", "/class", { headers: { Authorization: token } }),
    400,
    INVALID
  );
  const { id } = jwt.decode(token);
  expect(
    "token dengan tanda tangan salah",
    await call("GET", "/class", {
      token: jwt.sign({ id }, "bukan-secret-server", { expiresIn: "15m" }),
    }),
    400,
    INVALID
  );
  expect(
    "token kedaluwarsa: jwt expired (tidak diterjemahkan, dipakai web dan HP untuk refresh)",
    await call("GET", "/class", {
      token: jwt.sign(
        { id, iat: now() - 3600, exp: now() - 60 },
        process.env.JWT_SECRET
      ),
    }),
    400,
    "jwt expired"
  );
  expect(
    "token belum berlaku",
    await call("GET", "/class", {
      token: jwt.sign({ id, nbf: now() + 3600 }, process.env.JWT_SECRET),
    }),
    400,
    INVALID
  );
  expect(
    "token untuk akun yang tidak ada: jwt expired",
    await call("GET", "/class", {
      token: jwt.sign({ id: MISSING_ID }, process.env.JWT_SECRET, {
        expiresIn: "15m",
      }),
    }),
    400,
    "jwt expired"
  );

  section("Akun dihapus saat masih login");
  const studentToken = (await login(student, data.password)).token;
  expect(
    "sebelum dihapus: token mahasiswa sah",
    await call("GET", "/class/me", { token: studentToken }),
    200
  );
  await db.mst_user.delete({ where: { id: student.id } });
  expect(
    "setelah dihapus: jwt expired",
    await call("GET", "/class/me", { token: studentToken }),
    400,
    "jwt expired"
  );

  section("Koneksi real-time (SSE)");
  const sse = async (authorization) => {
    const res = await fetch(`${API}/events`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return {
      code: res.status,
      message: (await res.json().catch(() => ({}))).message,
    };
  };
  expect("SSE tanpa token", await sse(), 400, NO_TOKEN);
  expect("SSE token rusak", await sse("Bearer abc"), 400, INVALID);
});
