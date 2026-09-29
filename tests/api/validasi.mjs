import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  login,
  runTest,
  section,
} from "../bantuan/uji.mjs";

const data = new TestData("13");
const PAYMENT_REQUIRED = "Status pembayaran wajib diisi (true atau false)!";
const MEETING_REQUIRED = "Status sesi presensi wajib diisi (true atau false)!";
const PICK_SUBJECT = "Pilih minimal satu mata kuliah!";

await runTest("Input keliru ditolak dengan pesan jelas", data, async () => {
  const subject = await data.subject("Uji Validasi");
  const subject2 = await data.subject("Uji Validasi Dua");
  const classA = await data.classOf(subject, "A", "MONDAY", 1);
  const classB = await data.classOf(subject, "B", "TUESDAY", 1);
  const meeting = await data.meeting(classA, "Pertemuan Uji Validasi");
  const student = await data.student();
  const laboran = (await login(data.laboran, data.password)).token;
  const mahasiswa = (await login(student, data.password)).token;
  const as = (token, body) => ({ token, body });

  section("Pilih mata kuliah (mahasiswa)");
  expect(
    "daftar satu mata kuliah yang ada",
    await call(
      "POST",
      "/activation",
      as(mahasiswa, { subjectIds: [subject.id] })
    ),
    201
  );
  expect(
    "mata kuliah yang sama lagi: ditolak dengan nama, bukan ID",
    await call(
      "POST",
      "/activation",
      as(mahasiswa, { subjectIds: [subject.id] })
    ),
    409,
    "Mata kuliah berikut sudah pernah didaftarkan: Uji Validasi"
  );
  expect(
    "mata kuliah yang tidak ada",
    await call(
      "POST",
      "/activation",
      as(mahasiswa, { subjectIds: [MISSING_ID] })
    ),
    404,
    "Mata kuliah tidak ditemukan!"
  );
  expect(
    "daftar kosong",
    await call("POST", "/activation", as(mahasiswa, { subjectIds: [] })),
    400,
    PICK_SUBJECT
  );
  expect(
    "bukan daftar",
    await call(
      "POST",
      "/activation",
      as(mahasiswa, { subjectIds: subject2.id })
    ),
    400,
    PICK_SUBJECT
  );
  expect(
    "tanpa isi",
    await call("POST", "/activation", { token: mahasiswa }),
    400,
    PICK_SUBJECT
  );

  const activation = await db.trn_activations.findFirst({
    where: { userId: student.id, subjectId: subject.id },
  });
  const payment = `/activation/${activation.id}`;

  section("Ubah status pembayaran (laboran)");
  expect(
    "isian kosong {}",
    await call("PUT", payment, as(laboran, {})),
    400,
    PAYMENT_REQUIRED
  );
  expect(
    'salah ketik "Status"',
    await call("PUT", payment, as(laboran, { Status: false })),
    400,
    PAYMENT_REQUIRED
  );
  expect(
    'status berupa teks "true"',
    await call("PUT", payment, as(laboran, { status: "true" })),
    400,
    PAYMENT_REQUIRED
  );
  check(
    "  status tetap belum bayar setelah permintaan keliru",
    (await db.trn_activations.findUnique({ where: { id: activation.id } }))
      .status === false
  );
  expect(
    "kelas berupa angka",
    await call("PUT", payment, as(laboran, { status: true, classId: 5 })),
    400,
    "Kelas tidak valid!"
  );
  expect(
    "sudah bayar tanpa kelas",
    await call("PUT", payment, as(laboran, { status: true })),
    200,
    "Pembayaran dikonfirmasi. Mahasiswa memilih kelas sendiri di aplikasi."
  );
  expect(
    "belum bayar",
    await call("PUT", payment, as(laboran, { status: false })),
    200
  );
  expect(
    "sudah bayar dengan kelas kosong (null)",
    await call("PUT", payment, as(laboran, { status: true, classId: null })),
    200
  );
  expect(
    "sudah bayar dengan kelas A",
    await call(
      "PUT",
      payment,
      as(laboran, { status: true, classId: classA.id })
    ),
    200
  );
  check(
    "  mahasiswa masuk kelas A",
    !!(await db.trn_class_participants.findFirst({
      where: { userId: student.id, classId: classA.id },
    }))
  );

  section("Pindah kelas (laboran)");
  expect(
    "kelas berupa angka",
    await call("PUT", `${payment}/class`, as(laboran, { classId: 5 })),
    400,
    "Kelas tujuan wajib dipilih!"
  );
  expect(
    "tanpa isi",
    await call("PUT", `${payment}/class`, { token: laboran }),
    400,
    "Kelas tujuan wajib dipilih!"
  );
  expect(
    "pindah ke kelas B",
    await call("PUT", `${payment}/class`, as(laboran, { classId: classB.id })),
    200
  );

  section("Buka dan tutup sesi presensi (laboran)");
  const status = `/meeting/${meeting.id}/status`;
  expect(
    'status berupa teks "false": ditolak, bukan membuka sesi',
    await call("PUT", status, as(laboran, { status: "false" })),
    400,
    MEETING_REQUIRED
  );
  expect(
    "isian kosong",
    await call("PUT", status, as(laboran, {})),
    400,
    MEETING_REQUIRED
  );
  check(
    "  sesi tetap tertutup",
    (await db.trn_meetings.findUnique({ where: { id: meeting.id } })).status ===
      false
  );
  expect(
    "buka sesi",
    await call("PUT", status, as(laboran, { status: true })),
    200,
    "Sesi presensi dibuka"
  );
  expect(
    "tutup sesi",
    await call("PUT", status, as(laboran, { status: false })),
    200,
    "Sesi presensi ditutup"
  );

  section("Pengumuman (laboran)");
  expect(
    "judul berupa objek",
    await call(
      "POST",
      "/announcement",
      as(laboran, { type: "BASIC", title: {}, body: "isi" })
    ),
    400,
    "Judul pengumuman wajib diisi!"
  );
  const posted = await call(
    "POST",
    "/announcement",
    as(laboran, {
      type: "BASIC",
      title: "Uji Validasi Pengumuman",
      body: "sementara",
    })
  );
  expect("pengumuman lengkap", posted, 201);
  expect(
    "isi lebih dari 1000 karakter ditolak",
    await call(
      "POST",
      "/announcement",
      as(laboran, { type: "BASIC", title: "Judul", body: "x".repeat(1001) })
    ),
    400,
    "Deskripsi pengumuman maksimal 1000 karakter!"
  );
  const announcement = await db.mst_announcement.findFirst({
    where: { author: data.laboran.id },
  });
  expect(
    "ubah dengan isi berupa angka",
    await call(
      "PUT",
      `/announcement/${announcement.id}`,
      as(laboran, { type: "BASIC", title: "Judul", body: 123 })
    ),
    400,
    "Deskripsi pengumuman wajib diisi!"
  );
  expect(
    "ubah dengan isi tepat 1000 karakter",
    await call(
      "PUT",
      `/announcement/${announcement.id}`,
      as(laboran, { type: "BASIC", title: "Judul", body: "x".repeat(1000) })
    ),
    200
  );
  expect(
    "ubah dengan isian lengkap",
    await call(
      "PUT",
      `/announcement/${announcement.id}`,
      as(laboran, {
        type: "BASIC",
        title: "Uji Validasi Pengumuman",
        body: "diubah",
      })
    ),
    200
  );

  section("Umum");
  const unknown = await call("GET", "/tidak-ada", { token: laboran });
  check(
    "alamat tidak dikenal dibalas JSON 404",
    unknown.code === 404 &&
      unknown.isJson &&
      unknown.message === "Alamat tidak ditemukan!",
    `${unknown.code} ${unknown.message}`
  );
  expect(
    "isi permintaan terlalu besar",
    await call("POST", "/auth/login", {
      body: { nim: "x".repeat(200000), password: "x" },
    }),
    413,
    "Isi permintaan terlalu besar!"
  );
  expect(
    "JSON rusak",
    await call("POST", "/auth/login", {
      raw: "{nim:",
      contentType: "application/json",
    }),
    400,
    "Format JSON tidak valid!"
  );
});
