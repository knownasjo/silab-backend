import { db, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("15");
const DAYS = { MONDAY: "Senin", TUESDAY: "Selasa" };

await runTest(
  "Pilih kelas: bentrok jadwal, kuota, dan rebutan kursi",
  data,
  async () => {
    const sessions = await data.sessions();
    const when = (cls) => `${DAYS[cls.day]}, ${cls.startAt} - ${cls.endAt}`;
    const laboran = (await login(data.laboran, data.password)).token;
    const newStudent = async (n) => {
      const user = await data.student(
        `Uji Kelas ${String(n).padStart(2, "0")}`
      );
      return { ...user, token: (await login(user, data.password)).token };
    };
    const register = (student, classes) =>
      call("POST", "/class/registration", {
        token: student.token,
        body: { classIds: classes.map((cls) => cls.id) },
      });
    const pay = (activation, body) =>
      call("PUT", `/activation/${activation.id}`, { token: laboran, body });
    const move = (activation, cls) =>
      call("PUT", `/activation/${activation.id}/class`, {
        token: laboran,
        body: { classId: cls.id },
      });
    const classesIn = (student, subject) =>
      db.trn_class_participants.count({
        where: { userId: student.id, class: { subjectId: subject.id } },
      });

    const X = await data.subject("Uji Kelas X");
    const Y = await data.subject("Uji Kelas Y");
    const Z = await data.subject("Uji Kelas Z");
    const XA = await data.classOf(X, "A", "MONDAY", 1);
    const XB = await data.classOf(X, "B", "MONDAY", 2);
    const XC = await data.classOf(X, "C", "TUESDAY", 1);
    const XD = await data.classOf(X, "D", "TUESDAY", 1, { room: "SBTI" });
    const YA = await data.classOf(Y, "A", "MONDAY", 1, { room: "SBTI" });
    const YB = await data.classOf(Y, "B", "MONDAY", 3);
    const YC = await data.classOf(Y, "C", "MONDAY", 4);
    const [s1, s2, s3, s4, s5] = await Promise.all(
      [1, 2, 3, 4, 5].map(newStudent)
    );

    section("Mahasiswa memilih kelas sendiri");
    await data.activate(s1, X, true);
    await data.enroll(s1, XA);
    const s1Y = await data.activate(s1, Y, true);
    expect(
      "kelas yang bentrok dengan kelas yang sudah diikuti: ditolak",
      await register(s1, [YA]),
      409,
      `Jadwal bentrok: Uji Kelas Y kelas A (${when(YA)}) bersamaan dengan Uji Kelas X kelas A yang Anda ikuti.`
    );
    check("  tidak ada kelas Y yang tersimpan", (await classesIn(s1, Y)) === 0);
    expect(
      "kelas yang tidak bentrok: diterima",
      await register(s1, [YB]),
      201,
      "Berhasil terdaftar di kelas yang dipilih"
    );
    await data.activate(s2, X, true);
    await data.activate(s2, Y, true);
    expect(
      "dua kelas yang saling bentrok sekaligus: ditolak",
      await register(s2, [XA, YA]),
      409,
      `Jadwal bentrok: Uji Kelas Y kelas A (${when(YA)}) bersamaan dengan Uji Kelas X kelas A yang juga dipilih.`
    );
    check(
      "  tidak ada satu pun yang tersimpan",
      (await classesIn(s2, X)) + (await classesIn(s2, Y)) === 0
    );
    expect(
      "dua kelas yang tidak bentrok sekaligus: diterima",
      await register(s2, [XA, YB]),
      201
    );

    section("Laboran mengonfirmasi pembayaran");
    await data.activate(s3, X, true);
    await data.enroll(s3, XA);
    const s3Y = await data.activate(s3, Y, false);
    expect(
      "konfirmasi dengan kelas yang bentrok: ditolak",
      await pay(s3Y, { status: true, classId: YA.id }),
      409,
      `Jadwal bentrok: Uji Kelas Y kelas A (${when(YA)}) bersamaan dengan Uji Kelas X kelas A yang diikuti mahasiswa ini.`
    );
    check(
      "  status tetap belum bayar",
      (await db.trn_activations.findUnique({ where: { id: s3Y.id } }))
        .status === false
    );
    expect(
      "konfirmasi dengan kelas yang tidak bentrok: diterima",
      await pay(s3Y, { status: true, classId: YC.id }),
      200,
      "Pembayaran dikonfirmasi dan mahasiswa didaftarkan ke kelas C"
    );
    expect(
      "konfirmasi dengan kelas lain padahal sudah punya kelas: ditolak",
      await pay(s3Y, { status: true, classId: YB.id }),
      409,
      "Mahasiswa sudah terdaftar di kelas C untuk Uji Kelas Y!"
    );
    check("  tetap hanya satu kelas Y", (await classesIn(s3, Y)) === 1);
    const s4Y = await data.activate(s4, Y, false);
    expect(
      "konfirmasi tanpa kelas: mahasiswa memilih sendiri",
      await pay(s4Y, { status: true }),
      200,
      "Pembayaran dikonfirmasi. Mahasiswa memilih kelas sendiri di aplikasi."
    );
    const options = await call("GET", "/class/registration", {
      token: s4.token,
    });
    check(
      "  ketiga kelas Y langsung muncul di pilihan HP mahasiswa",
      (options.json.data ?? []).filter((o) => o.subject_name === "Uji Kelas Y")
        .length === 3,
      JSON.stringify(
        options.json.data?.map((o) => `${o.subject_name} ${o.subject_class}`)
      )
    );
    expect(
      "konfirmasi ulang tanpa kelas untuk yang sudah punya kelas",
      await pay(s3Y, { status: true }),
      200,
      "Status pembayaran berhasil diperbarui"
    );
    expect(
      "batal bayar mengeluarkan mahasiswa dari kelas",
      await pay(s3Y, { status: false }),
      200,
      "Status pembayaran diubah menjadi belum bayar dan mahasiswa dikeluarkan dari kelas C"
    );
    expect(
      "konfirmasi ulang setelah dibatalkan: mahasiswa memilih sendiri",
      await pay(s3Y, { status: true }),
      200,
      "Pembayaran dikonfirmasi. Mahasiswa memilih kelas sendiri di aplikasi."
    );

    section("Laboran memindahkan kelas");
    expect(
      "pindah ke jadwal yang bentrok: ditolak",
      await move(s1Y, YA),
      409,
      `Jadwal bentrok: Uji Kelas Y kelas A (${when(YA)}) bersamaan dengan Uji Kelas X kelas A yang diikuti mahasiswa ini.`
    );
    const s1X = await db.trn_activations.findFirst({
      where: { userId: s1.id, subjectId: X.id },
    });
    expect(
      "pindah kelas X dari A ke B (tidak bentrok): diterima",
      await move(s1X, XB),
      200
    );
    expect("setelah itu kelas Y boleh pindah ke A", await move(s1Y, YA), 200);
    const s5X = await data.activate(s5, X, true);
    await data.enroll(s5, XC);
    expect(
      "pindah ke kelas lain di jam yang sama (kelas lama tidak dihitung): diterima",
      await move(s5X, XD),
      200
    );

    section("Laboran mengubah jadwal kelas");
    expect(
      "jadwal baru membuat peserta bentrok: ditolak",
      await call("PUT", `/class/${XA.id}`, {
        token: laboran,
        body: { sessionId: sessions[2].id, room: "SBTI" },
      }),
      409,
      `Jadwal baru bentrok: peserta Uji Kelas 02 mengikuti praktikum Uji Kelas Y kelas B (${when(YB)}).`
    );
    const unchanged = await db.mst_class.findUnique({ where: { id: XA.id } });
    check(
      "  jadwal kelas tidak berubah",
      unchanged.startAt === XA.startAt && unchanged.room === "PSI"
    );
    expect(
      "jadwal baru yang tidak membuat bentrok: diterima",
      await call("PUT", `/class/${XA.id}`, {
        token: laboran,
        body: { sessionId: sessions[4].id, room: "SBTI" },
      }),
      200
    );

    section("Urutan pilihan kelas");
    const W = await data.subject("Uji Kelas W");
    await data.classOf(W, "C", "THURSDAY", 1);
    await data.classOf(W, "A", "THURSDAY", 2);
    await data.classOf(W, "B", "THURSDAY", 3);
    const s16 = await newStudent(16);
    await data.activate(s16, X, true);
    await data.activate(s16, W, true);
    const sorted = await call("GET", "/class/registration", {
      token: s16.token,
    });
    const labels = (sorted.json.data ?? []).map(
      (o) => `${o.subject_name} ${o.subject_class}`
    );
    check(
      "mata kuliah dan kelas urut A→Z walau dibuat acak",
      JSON.stringify(labels) ===
        JSON.stringify([
          "Uji Kelas W A",
          "Uji Kelas W B",
          "Uji Kelas W C",
          "Uji Kelas X A",
          "Uji Kelas X B",
          "Uji Kelas X C",
          "Uji Kelas X D",
        ]),
      JSON.stringify(labels)
    );

    section("Rebutan kursi");
    const ZA = await data.classOf(Z, "A", "WEDNESDAY", 5, { quota: 3 });
    const ZB = await data.classOf(Z, "B", "WEDNESDAY", 6);
    const ZC = await data.classOf(Z, "C", "WEDNESDAY", 6, { room: "SBTI" });
    const racers = await Promise.all(
      [6, 7, 8, 9, 10, 11, 12, 13].map(newStudent)
    );
    await Promise.all(racers.map((student) => data.activate(student, Z, true)));
    const results = await Promise.all(
      racers.map((student) => register(student, [ZA]))
    );
    const wins = results.filter((r) => r.code === 201).length;
    const full = results.filter(
      (r) => r.code === 409 && r.message === "Kelas A Uji Kelas Z sudah penuh!"
    ).length;
    const seated = await db.trn_class_participants.count({
      where: { classId: ZA.id },
    });
    check(
      `8 mahasiswa bersamaan ke kelas kuota 3: tepat 3 berhasil (berhasil ${wins}, penuh ${full})`,
      wins === 3 && full === 5,
      JSON.stringify(results.map((r) => `${r.code} ${r.message}`))
    );
    check(`  isi kelas tepat 3/3 (tercatat ${seated})`, seated === 3);
    expect(
      "kuota diturunkan di bawah jumlah peserta: ditolak",
      await call("PUT", `/class/${ZA.id}`, {
        token: laboran,
        body: { quota: 2 },
      }),
      409,
      "Kuota tidak boleh kurang dari jumlah peserta (3)!"
    );
    const [s14, s15] = await Promise.all([14, 15].map(newStudent));
    await data.activate(s14, Z, true);
    const double = await Promise.all([
      register(s14, [ZB]),
      register(s14, [ZC]),
    ]);
    check(
      "satu mahasiswa mengirim dua pilihan bersamaan: tepat satu berhasil",
      double.filter((r) => r.code === 201).length === 1,
      JSON.stringify(double.map((r) => `${r.code} ${r.message}`))
    );
    check("  hanya punya satu kelas Z", (await classesIn(s14, Z)) === 1);
    const s15Z = await data.activate(s15, Z, true);
    const mixed = await Promise.all([
      register(s15, [ZB]),
      pay(s15Z, { status: true, classId: ZC.id }),
    ]);
    check(
      "mahasiswa memilih sendiri bersamaan dengan laboran menetapkan kelas: tepat satu berhasil",
      mixed.filter((r) => r.code === 200 || r.code === 201).length === 1,
      JSON.stringify(mixed.map((r) => `${r.code} ${r.message}`))
    );
    check("  hanya punya satu kelas Z", (await classesIn(s15, Z)) === 1);
    const errors = [...results, ...double, ...mixed].filter(
      (r) => r.code >= 500
    );
    check(
      "tidak ada error server selama rebutan",
      errors.length === 0,
      JSON.stringify(errors.map((r) => r.message))
    );
  }
);
