import { db, TestData } from "../bantuan/data.mjs";
import { call, check, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("27");
const SUBJECT = "Uji Kelas Bersamaan";
const OTHER = "Uji Kelas Bersamaan Lain";

await runTest("Tambah dan ubah kelas bersamaan", data, async () => {
  const subject = await data.subject(SUBJECT);
  const other = await data.subject(OTHER);
  const sessions = await data.sessions();
  const token = (await login(data.laboran, data.password)).token;
  const all = [];

  const together = async (requests) => {
    const results = await Promise.all(requests);
    all.push(...results);
    return results;
  };
  const add = (target, body) =>
    call("POST", "/class", {
      token,
      body: { subjectId: target.id, quota: 20, ...body },
    });
  const update = (cls, body) =>
    call("PUT", `/class/${cls.id}`, { token, body });
  const summary = (results) =>
    JSON.stringify(results.map((r) => `${r.code} ${r.message}`));
  const succeeded = (results) =>
    results.filter((r) => r.code === 200 || r.code === 201).length;
  const countClasses = (where) =>
    db.mst_class.count({
      where: {
        periodId: data.period.id,
        subjectId: { in: [subject.id, other.id] },
        ...where,
      },
    });

  section("Nama kelas yang sama dikirim bersamaan");
  for (const [day, name] of [
    ["MONDAY", "F"],
    ["TUESDAY", "G"],
    ["WEDNESDAY", "H"],
  ]) {
    const results = await together(
      sessions
        .slice(0, 4)
        .map((session) =>
          add(subject, { name, day, room: "SBTI", sessionId: session.id })
        )
    );
    check(
      `4 kelas ${name} bersamaan: tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Kelas ${name} sudah ada di ${SUBJECT}!"`,
      results.filter(
        (r) =>
          r.code === 409 &&
          r.message === `Kelas ${name} sudah ada di ${SUBJECT}!`
      ).length === 3,
      summary(results)
    );
    const saved = await countClasses({ subjectId: subject.id, name });
    check(`  kelas ${name} tersimpan tepat satu (${saved})`, saved === 1);
  }

  section("Ruang dan jam yang sama dikirim bersamaan");
  for (const [index, names] of [
    ["P", "Q", "R", "S"],
    ["T", "U", "V", "W"],
  ].entries()) {
    const session = sessions[index];
    const results = await together(
      names.map((name, i) =>
        add(i % 2 === 0 ? subject : other, {
          name,
          day: "THURSDAY",
          room: "PSI",
          sessionId: session.id,
        })
      )
    );
    check(
      `4 kelas dari 2 mata kuliah di PSI Kamis ${session.startAt}: tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Ruang PSI sudah dipakai ..."`,
      results.filter(
        (r) =>
          r.code === 409 && r.message.startsWith("Ruang PSI sudah dipakai ")
      ).length === 3,
      summary(results)
    );
    const saved = await countClasses({
      day: "THURSDAY",
      room: "PSI",
      sessionId: session.id,
    });
    check(`  ruang itu dipakai tepat satu kelas (${saved})`, saved === 1);
  }

  section("Ubah nama dan pindah ruang bersamaan");
  const k = await data.classOf(subject, "K", "THURSDAY", 3, { room: "SBTI" });
  const l = await data.classOf(subject, "L", "THURSDAY", 4, { room: "SBTI" });
  const renames = await together([
    update(k, { name: "Z" }),
    update(l, { name: "Z" }),
  ]);
  check(
    "kelas K dan L diganti nama Z bersamaan: tepat satu berhasil",
    succeeded(renames) === 1 &&
      renames.some(
        (r) =>
          r.code === 409 && r.message === `Kelas Z sudah ada di ${SUBJECT}!`
      ),
    summary(renames)
  );
  const named = await countClasses({ subjectId: subject.id, name: "Z" });
  check(`  kelas Z tepat satu (${named})`, named === 1);

  const m = await data.classOf(subject, "M", "WEDNESDAY", 5);
  const n = await data.classOf(other, "N", "THURSDAY", 5);
  const target = { day: "TUESDAY", room: "PSI", sessionId: sessions[5].id };
  const moves = await together([update(m, target), update(n, target)]);
  check(
    "kelas M dan N dipindah ke PSI Selasa jam yang sama bersamaan: tepat satu berhasil",
    succeeded(moves) === 1 &&
      moves.some(
        (r) =>
          r.code === 409 && r.message.startsWith("Ruang PSI sudah dipakai ")
      ),
    summary(moves)
  );
  const moved = await countClasses(target);
  check(`  ruang itu dipakai tepat satu kelas (${moved})`, moved === 1);

  section("Tambah kelas dan ubah nama bersamaan");
  const o = await data.classOf(subject, "O", "MONDAY", 5);
  const mixed = await together([
    add(subject, {
      name: "Y",
      day: "MONDAY",
      room: "PSI",
      sessionId: sessions[5].id,
    }),
    update(o, { name: "Y" }),
  ]);
  check(
    "kelas baru Y dan kelas O diganti Y bersamaan: tepat satu berhasil",
    succeeded(mixed) === 1,
    summary(mixed)
  );
  const ys = await countClasses({ subjectId: subject.id, name: "Y" });
  check(`  kelas Y tepat satu (${ys})`, ys === 1);

  check(
    `tidak ada error server dari ${all.length} permintaan`,
    all.every((r) => r.code < 500),
    summary(all.filter((r) => r.code >= 500))
  );
});
