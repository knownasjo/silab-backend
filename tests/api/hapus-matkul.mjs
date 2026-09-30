import { db, MISSING_ID, TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  expect,
  listenEvents,
  login,
  runTest,
  section,
  sleep,
} from "../bantuan/uji.mjs";

const data = new TestData("24");
const NOT_FOUND = "Mata kuliah tidak ditemukan!";

await runTest("Hapus mata kuliah", data, async () => {
  const laboran = (await login(data.laboran, data.password)).token;
  const dosen = (await login(data.lecturer, data.password)).token;
  const studentUser = await data.student("Uji Hapus Matkul");
  const student = (await login(studentUser, data.password)).token;
  const remove = (subject, token = laboran) =>
    call("DELETE", `/subject/${subject.id}`, { token });
  const exists = async (subject) =>
    (await db.mst_subject.count({ where: { id: subject.id } })) === 1;

  section("Mata kuliah yang belum pernah dipakai");
  const unused = await data.subject("Uji Matkul Kosong");
  const events = [];
  const stream = await listenEvents(student, (type, payload) =>
    events.push({ type, ...payload })
  );
  expect(
    "mahasiswa: ditolak",
    await remove(unused, student),
    403,
    "Hanya laboran yang dapat menghapus mata kuliah!"
  );
  expect(
    "dosen: ditolak",
    await remove(unused, dosen),
    403,
    "Hanya laboran yang dapat menghapus mata kuliah!"
  );
  check("  mata kuliah tetap ada", await exists(unused));
  expect(
    "laboran menghapus",
    await remove(unused),
    200,
    "Mata kuliah Uji Matkul Kosong berhasil dihapus"
  );
  check("  terhapus dari database", !(await exists(unused)));
  const list = await call("GET", "/subject", { token: student });
  check(
    "  tidak tampil lagi di daftar mata kuliah mahasiswa",
    list.code === 200 &&
      !(list.json.data ?? []).some((subject) => subject.id === unused.id)
  );
  await sleep(500);
  stream.close();
  check(
    "  mahasiswa menerima event real-time subject (deleted)",
    events.some(
      (e) =>
        e.type === "subject" &&
        e.subject_id === unused.id &&
        e.action === "deleted"
    ),
    JSON.stringify(events)
  );
  expect("  hapus lagi: tidak ditemukan", await remove(unused), 404, NOT_FOUND);
  expect(
    "id yang tidak ada: tidak ditemukan",
    await remove({ id: MISSING_ID }),
    404,
    NOT_FOUND
  );
  expect(
    "kode dan nama yang sama bisa dipakai lagi untuk mata kuliah baru",
    await call("POST", "/subject", {
      token: laboran,
      body: {
        subject_code: unused.subject_code,
        subject_name: unused.subject_name,
        semester: "3",
        lecturer_id: data.lecturer.id,
      },
    }),
    201
  );

  section("Mata kuliah yang sudah dipakai");
  const withClass = await data.subject("Uji Matkul Berkelas");
  await data.classOf(withClass, "A", "MONDAY", 1);
  expect(
    "punya kelas: ditolak",
    await remove(withClass),
    409,
    "Uji Matkul Berkelas sudah punya 1 kelas, jadi tidak bisa dihapus."
  );
  const withActivation = await data.subject("Uji Matkul Terdaftar");
  await data.activate(studentUser, withActivation, false);
  expect(
    "punya pendaftaran (belum bayar): ditolak",
    await remove(withActivation),
    409,
    "Uji Matkul Terdaftar sudah punya 1 pendaftaran, jadi tidak bisa dihapus."
  );
  const withBoth = await data.subject("Uji Matkul Lengkap");
  await data.classOf(withBoth, "A", "TUESDAY", 1);
  await data.classOf(withBoth, "B", "TUESDAY", 2);
  const others = await Promise.all([data.student(), data.student()]);
  for (const user of [studentUser, ...others])
    await data.activate(user, withBoth, true);
  expect(
    "punya kelas dan pendaftaran: ditolak dengan jumlah keduanya",
    await remove(withBoth),
    409,
    "Uji Matkul Lengkap sudah punya 2 kelas dan 3 pendaftaran, jadi tidak bisa dihapus."
  );
  check(
    "  ketiganya tetap ada",
    (await exists(withClass)) &&
      (await exists(withActivation)) &&
      (await exists(withBoth))
  );

  section("Bersamaan");
  const session = (await data.sessions())[5];
  const delays = Array.from({ length: 9 }, (_, i) => i * 50);
  const race = async (label, makeRequest, winCode, loseCode) => {
    let consistent = 0;
    for (const [round, delay] of delays.entries()) {
      const subject = await data.subject(
        `Uji Matkul Rebutan ${label} ${round}`
      );
      const [removed, used] = await Promise.all([
        remove(subject),
        sleep(delay).then(() => makeRequest(subject)),
      ]);
      const stillThere = await exists(subject);
      const ok =
        (removed.code === 200 && used.code === 404 && !stillThere) ||
        (used.code === winCode && removed.code === loseCode && stillThere);
      if (ok) consistent++;
      else
        console.log(
          `   ${label} putaran ${round + 1} (jeda ${delay} ms): hapus ${removed.code} ${removed.message} | ${used.code} ${used.message}`
        );
      await db.mst_class.deleteMany({ where: { subjectId: subject.id } });
      await db.trn_activations.deleteMany({ where: { subjectId: subject.id } });
    }
    return consistent;
  };
  const registered = await race(
    "daftar",
    (subject) =>
      call("POST", "/activation", {
        token: student,
        body: { subjectIds: [subject.id] },
      }),
    201,
    409
  );
  check(
    `hapus bersamaan dengan mahasiswa mendaftar (jeda 0–400 ms): satu yang menang, tanpa error server (${registered}/${delays.length})`,
    registered === delays.length
  );
  const classed = await race(
    "kelas",
    (subject) =>
      call("POST", "/class", {
        token: laboran,
        body: {
          subjectId: subject.id,
          name: "A",
          quota: 30,
          day: "THURSDAY",
          room: "PSI",
          sessionId: session.id,
        },
      }),
    201,
    409
  );
  check(
    `hapus bersamaan dengan tambah kelas (jeda 0–400 ms): satu yang menang, tanpa error server (${classed}/${delays.length})`,
    classed === delays.length
  );
});
