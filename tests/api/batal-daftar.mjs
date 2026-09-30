import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
  sleep,
} from "../bantuan/uji.mjs";

const data = new TestData("23");
const NOT_FOUND = "Data aktivasi tidak ditemukan!";
const PAID_STUDENT =
  "Pendaftaran yang sudah lunas tidak bisa dibatalkan. Hubungi laboran bila perlu dibatalkan.";
const PAID_LABORAN =
  "Pendaftaran yang sudah lunas tidak bisa dihapus. Ubah statusnya menjadi Belum Bayar dulu.";

await runTest("Batal pendaftaran mata kuliah", data, async () => {
  const laboran = (await login(data.laboran, data.password)).token;
  const dosen = (await login(data.lecturer, data.password)).token;
  const newStudent = async (name) => {
    const user = await data.student(name);
    return { ...user, token: (await login(user, data.password)).token };
  };
  const remove = (activation, token) =>
    call("DELETE", `/activation/${activation.id}`, { token });
  const exists = async (activation) =>
    (await db.trn_activations.count({ where: { id: activation.id } })) === 1;
  const statusOf = async (activation) =>
    (await db.trn_activations.findUnique({ where: { id: activation.id } }))
      ?.status;
  const findActivation = (student, subject) =>
    db.trn_activations.findFirst({
      where: { userId: student.id, subjectId: subject.id },
    });

  const X = await data.subject("Uji Daftar X");
  const Y = await data.subject("Uji Daftar Y");
  const XA = await data.classOf(X, "A", "MONDAY", 1);
  const s1 = await newStudent("Uji Daftar Satu");
  const s2 = await newStudent("Uji Daftar Dua");
  const s3 = await newStudent("Uji Daftar Tiga");

  section("Mahasiswa membatalkan sendiri");
  expect(
    "mendaftar mata kuliah X dari aplikasi",
    await call("POST", "/activation", {
      token: s1.token,
      body: { subjectIds: [X.id] },
    }),
    201
  );
  const own = await findActivation(s1, X);
  expect(
    "membatalkan pendaftaran yang belum lunas",
    await remove(own, s1.token),
    200,
    "Pendaftaran Uji Daftar X dibatalkan."
  );
  check("  pendaftaran benar-benar terhapus", !(await exists(own)));
  expect(
    "  membatalkan lagi: tidak ditemukan",
    await remove(own, s1.token),
    404,
    NOT_FOUND
  );
  expect(
    "  mata kuliah X bisa didaftarkan lagi di semester yang sama",
    await call("POST", "/activation", {
      token: s1.token,
      body: { subjectIds: [X.id] },
    }),
    201
  );
  const paid = await data.activate(s1, Y, true);
  expect(
    "pendaftaran yang sudah lunas: ditolak",
    await remove(paid, s1.token),
    409,
    PAID_STUDENT
  );
  check("  tetap tersimpan dan lunas", (await statusOf(paid)) === true);
  const others = await data.activate(s2, X, false);
  expect(
    "pendaftaran milik mahasiswa lain: tidak ditemukan",
    await remove(others, s1.token),
    404,
    NOT_FOUND
  );
  check("  pendaftaran mahasiswa lain tetap ada", await exists(others));
  expect(
    "id yang tidak ada: tidak ditemukan",
    await remove({ id: MISSING_ID }, s1.token),
    404,
    NOT_FOUND
  );

  section("Laboran menghapus");
  expect(
    "dosen: ditolak",
    await remove(others, dosen),
    403,
    "Hanya laboran atau mahasiswa pemilik pendaftaran yang dapat membatalkannya!"
  );
  check("  pendaftaran tetap ada", await exists(others));
  expect(
    "laboran menghapus pendaftaran yang belum bayar",
    await remove(others, laboran),
    200,
    "Pendaftaran Uji Daftar X milik Uji Daftar Dua dihapus."
  );
  check("  pendaftaran terhapus", !(await exists(others)));
  expect(
    "laboran menghapus pendaftaran yang sudah lunas: ditolak",
    await remove(paid, laboran),
    409,
    PAID_LABORAN
  );
  const inClass = await data.activate(s3, X, true);
  await data.enroll(s3, XA);
  expect(
    "  batal bayar dulu (mahasiswa keluar dari kelas A)",
    await call("PUT", `/activation/${inClass.id}`, {
      token: laboran,
      body: { status: false },
    }),
    200,
    "Status pembayaran diubah menjadi belum bayar dan mahasiswa dikeluarkan dari kelas A"
  );
  expect(
    "  lalu hapus: berhasil",
    await remove(inClass, laboran),
    200,
    "Pendaftaran Uji Daftar X milik Uji Daftar Tiga dihapus."
  );
  const legacy = await data.activate(s2, X, false);
  await data.enroll(s2, XA);
  expect(
    "belum bayar tapi masih punya kelas (data lama): ditolak",
    await remove(legacy, laboran),
    409,
    "Pendaftaran ini masih punya kelas A, jadi tidak bisa dihapus."
  );
  check("  pendaftaran tetap ada", await exists(legacy));

  section("Bersamaan dengan konfirmasi bayar");
  const s4 = await newStudent("Uji Daftar Empat");
  const delays = Array.from({ length: 17 }, (_, i) => i * 25);
  let consistent = 0;
  for (const [round, delay] of delays.entries()) {
    await db.trn_activations.deleteMany({ where: { userId: s4.id } });
    const activation = await data.activate(s4, X, false);
    const [cancel, confirm] = await Promise.all([
      remove(activation, s4.token),
      sleep(delay).then(() =>
        call("PUT", `/activation/${activation.id}`, {
          token: laboran,
          body: { status: true },
        })
      ),
    ]);
    const status = await statusOf(activation);
    const ok =
      (cancel.code === 200 && confirm.code === 404 && status === undefined) ||
      (confirm.code === 200 && cancel.code === 409 && status === true);
    if (ok) consistent++;
    else
      console.log(
        `   putaran ${round + 1} (jeda ${delay} ms): batal ${cancel.code} ${cancel.message} | bayar ${confirm.code} ${confirm.message} | status ${status}`
      );
  }
  check(
    `mahasiswa membatalkan tepat saat laboran mengonfirmasi bayar (jeda 0–400 ms): selalu satu yang menang, tanpa error server (${consistent}/${delays.length})`,
    consistent === delays.length
  );
});
