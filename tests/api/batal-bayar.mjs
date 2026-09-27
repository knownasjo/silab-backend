import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("16");

await runTest("Batal bayar", data, async () => {
  const laboran = (await login(data.laboran, data.password)).token;
  const newStudent = async () => {
    const user = await data.student();
    return { ...user, token: (await login(user, data.password)).token };
  };
  const pay = (activation, body) =>
    call("PUT", `/activation/${activation.id}`, { token: laboran, body });
  const register = (student, cls) =>
    call("POST", "/class/registration", {
      token: student.token,
      body: { classIds: [cls.id] },
    });
  const statusOf = async (activation) =>
    (await db.trn_activations.findUnique({ where: { id: activation.id } }))
      .status;
  const inClass = (student, cls) =>
    db.trn_class_participants.count({
      where: { userId: student.id, classId: cls.id },
    });

  const X = await data.subject("Uji Batal X");
  const XA = await data.classOf(X, "A", "MONDAY", 1);
  const XB = await data.classOf(X, "B", "MONDAY", 2);
  const XC = await data.classOf(X, "C", "MONDAY", 3, { quota: 1 });
  const [s1, s2, s3, s4, s5, s6] = await Promise.all(
    Array.from({ length: 6 }, newStudent)
  );

  section("Belum ada presensi");
  const a1 = await data.activate(s1, X, true);
  await data.enroll(s1, XA);
  expect(
    "batal bayar: mahasiswa dikeluarkan dari kelas",
    await pay(a1, { status: false }),
    200,
    "Status pembayaran diubah menjadi belum bayar dan mahasiswa dikeluarkan dari kelas A"
  );
  check("  status menjadi belum bayar", (await statusOf(a1)) === false);
  check("  tidak lagi di kelas A", (await inClass(s1, XA)) === 0);
  const options = await call("GET", "/class/registration", { token: s1.token });
  check(
    "  tidak ditawari pilih kelas karena belum bayar",
    (options.json.data ?? []).length === 0,
    JSON.stringify(options.json.data)
  );
  expect(
    "konfirmasi ulang tanpa kelas: mahasiswa memilih sendiri",
    await pay(a1, { status: true }),
    200,
    "Pembayaran dikonfirmasi. Mahasiswa memilih kelas sendiri di aplikasi."
  );

  section("Sudah ada presensi");
  const a2 = await data.activate(s2, X, true);
  await data.enroll(s2, XA);
  const m1 = await data.meeting(XA, "Pertemuan 1");
  const m2 = await data.meeting(XA, "Pertemuan 2");
  await data.attend(m1, s2, true);
  await data.attend(m2, s2, false);
  expect(
    "batal bayar setelah ada presensi (hadir dan tidak hadir): ditolak",
    await pay(a2, { status: false }),
    409,
    "Mahasiswa sudah punya 2 presensi di kelas A. Hapus presensinya dulu bila pembayaran memang harus dibatalkan."
  );
  check("  status tetap sudah bayar", (await statusOf(a2)) === true);
  check("  tetap di kelas A", (await inClass(s2, XA)) === 1);

  section("Belum punya kelas");
  const a3 = await data.activate(s3, X, true);
  expect(
    "batal bayar: pesan biasa",
    await pay(a3, { status: false }),
    200,
    "Status pembayaran diubah menjadi belum bayar"
  );
  expect(
    "belum bayar sambil memilih kelas: ditolak",
    await pay(a3, { status: false, classId: XB.id }),
    400,
    "Tidak bisa mendaftarkan kelas saat status diubah menjadi belum bayar!"
  );

  section("Kursi yang dilepas");
  const a5 = await data.activate(s5, X, true);
  await data.enroll(s5, XC);
  await data.activate(s6, X, true);
  expect(
    "kelas C (kuota 1) penuh sebelum dibatalkan",
    await register(s6, XC),
    409,
    "Kelas C Uji Batal X sudah penuh!"
  );
  await pay(a5, { status: false });
  expect(
    "setelah dibatalkan, kursinya bisa diambil mahasiswa lain",
    await register(s6, XC),
    201
  );

  section("Bersamaan");
  let consistent = 0;
  for (let round = 0; round < 3; round++) {
    const a4 = await db.trn_activations.upsert({
      where: { userId_subjectId: { userId: s4.id, subjectId: X.id } },
      update: { status: true },
      create: { userId: s4.id, subjectId: X.id, status: true },
    });
    await db.trn_class_participants.deleteMany({ where: { userId: s4.id } });
    const race = await Promise.all([
      register(s4, XB),
      pay(a4, { status: false }),
    ]);
    const ok =
      (await statusOf(a4)) === false &&
      (await inClass(s4, XB)) === 0 &&
      race.every((r) => r.code < 500);
    if (ok) consistent++;
    else
      console.log(
        `   putaran ${round + 1}: ${race.map((r) => `${r.code} ${r.message}`).join(" | ")}`
      );
  }
  check(
    `pilih kelas bersamaan dengan batal bayar: selalu berakhir belum bayar dan tanpa kelas (${consistent}/3)`,
    consistent === 3
  );
  const participants = await db.trn_class_participants.findMany({
    where: { class: { subjectId: X.id } },
    include: {
      user: {
        select: {
          fullname: true,
          userActivation: {
            where: { subjectId: X.id },
            select: { status: true },
          },
        },
      },
    },
  });
  const unpaid = participants.filter(
    (p) => !p.user.userActivation.some((activation) => activation.status)
  );
  check(
    "tidak ada peserta kelas yang belum bayar",
    unpaid.length === 0,
    JSON.stringify(unpaid.map((p) => p.user.fullname))
  );
});
