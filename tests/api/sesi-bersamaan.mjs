import { db, TestData } from "../bantuan/data.mjs";
import { call, check, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("30");
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const at = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
const ROOM = "SBTI";
const MANY_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY"];
const WINDOW = [toMinutes("22.30"), toMinutes("23.59")];

await runTest("Simpan jam sesi bersamaan", data, async () => {
  const token = (await login(data.laboran, data.password)).token;
  const all = [];
  const placeOf = (day) => ({ periodId: data.period.id, room: ROOM, day });
  const friday = placeOf("FRIDAY");
  const freeOn = async (days) => {
    const existing = await db.mst_session.findMany({
      where: { periodId: data.period.id, room: ROOM, day: { in: days } },
    });
    const used = new Set(existing.map((session) => session.number));
    const busy = existing.some(
      (session) =>
        toMinutes(session.startAt) < WINDOW[1] &&
        WINDOW[0] < toMinutes(session.endAt)
    );
    return {
      busy,
      free: Array.from({ length: 20 }, (_, i) => 20 - i).filter(
        (number) => !used.has(number)
      ),
    };
  };
  const { busy, free } = await freeOn(["FRIDAY"]);
  const spread = await freeOn(MANY_DAYS);
  if (free.length < 8 || busy || spread.free.length < 3 || spread.busy)
    throw new Error(
      `Butuh 8 nomor sesi Jumat ${ROOM} dan 3 nomor sesi Senin–Rabu ${ROOM} yang kosong, serta jam 22.30–23.59 yang kosong di hari-hari itu`
    );

  const together = async (requests) => {
    const results = await Promise.all(requests);
    all.push(...results);
    return results;
  };
  const add = (number, start, end, extra = {}) =>
    call("POST", "/session", {
      token,
      body: {
        room: ROOM,
        day: "FRIDAY",
        number,
        startAt: at(start),
        endAt: at(end),
        ...extra,
      },
    });
  const update = (session, body) =>
    call("PUT", `/session/${session.id}`, { token, body });
  const summary = (results) =>
    JSON.stringify(results.map((r) => `${r.code} ${r.message}`));
  const succeeded = (results) =>
    results.filter((r) => r.code === 200 || r.code === 201).length;
  const ours = (place = friday) =>
    db.mst_session.findMany({
      where: { ...place, createdBy: data.laboran.id },
    });
  const clear = async () =>
    db.mst_session.deleteMany({
      where: {
        periodId: data.period.id,
        room: ROOM,
        createdBy: data.laboran.id,
        number: { lte: 20 },
      },
    });
  const overlapping = async (place = friday) => {
    const list = await db.mst_session.findMany({ where: place });
    let pairs = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (
          toMinutes(list[i].startAt) < toMinutes(list[j].endAt) &&
          toMinutes(list[j].startAt) < toMinutes(list[i].endAt)
        )
          pairs++;
    return pairs;
  };

  section("Nomor yang sama dikirim bersamaan");
  for (const [round, number] of free.slice(0, 3).entries()) {
    const start = WINDOW[0] + round * 25;
    const results = await together(
      [0, 1, 2, 3].map((n) => add(number, start + n * 5, start + n * 5 + 4))
    );
    check(
      `4 sesi bernomor ${number} bersamaan: tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Sesi ${number} Jumat ${ROOM} sudah ada!"`,
      results.filter(
        (r) =>
          r.code === 409 &&
          r.message === `Sesi ${number} Jumat ${ROOM} sudah ada!`
      ).length === 3,
      summary(results)
    );
  }
  await clear();

  section("Jam yang bertabrakan dikirim bersamaan");
  for (const round of [0, 1, 2]) {
    const start = WINDOW[0] + round * 30;
    const numbers = free.slice(round * 2, round * 2 + 4);
    const results = await together(
      numbers.map((number, n) => add(number, start + n * 3, start + n * 3 + 20))
    );
    check(
      `4 sesi Jumat ${at(start)}–${at(start + 29)} bersamaan: tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Jam sesi bertabrakan dengan ..."`,
      results.filter(
        (r) =>
          r.code === 409 &&
          r.message.startsWith("Jam sesi bertabrakan dengan Sesi ")
      ).length === 3,
      summary(results)
    );
    await clear();
  }

  section("Ubah bersamaan");
  const created = [];
  for (const [number, start, end] of [
    [free[0], "22.30", "22.40"],
    [free[1], "23.30", "23.40"],
  ]) {
    const res = await call("POST", "/session", {
      token,
      body: { room: ROOM, day: "FRIDAY", number, startAt: start, endAt: end },
    });
    all.push(res);
    created.push(res.json.data);
  }
  const [first, second] = created;
  const stretched = await together([
    update(first, { startAt: "22.30", endAt: "23.00" }),
    update(second, { startAt: "22.50", endAt: "23.40" }),
  ]);
  check(
    "dua sesi diperpanjang bersamaan sampai saling bertabrakan: tepat satu berhasil",
    succeeded(stretched) === 1 &&
      stretched.some(
        (r) =>
          r.code === 409 &&
          r.message.startsWith("Jam sesi bertabrakan dengan Sesi ")
      ),
    summary(stretched)
  );
  check(
    "  tidak ada sesi Jumat yang jamnya tumpang tindih",
    (await overlapping()) === 0
  );
  const renumbered = await together([
    update(first, { number: free[2] }),
    update(second, { number: free[2] }),
  ]);
  check(
    `dua sesi diganti ke nomor ${free[2]} bersamaan: tepat satu berhasil, yang lain 409 "sudah ada"`,
    succeeded(renumbered) === 1 &&
      renumbered.some(
        (r) =>
          r.code === 409 &&
          r.message === `Sesi ${free[2]} Jumat ${ROOM} sudah ada!`
      ),
    summary(renumbered)
  );
  const numbers = (await ours()).map((session) => session.number);
  check(
    `  nomor ${free[2]} dipakai tepat satu sesi`,
    numbers.filter((number) => number === free[2]).length === 1,
    JSON.stringify(numbers)
  );
  await clear();

  section("Beberapa hari sekaligus, bersamaan");
  for (const [round, number] of spread.free.slice(0, 3).entries()) {
    const start = WINDOW[0] + round * 25;
    const orders = [MANY_DAYS, [...MANY_DAYS].reverse(), [MANY_DAYS[1], MANY_DAYS[0], MANY_DAYS[2]]];
    const results = await together(
      orders.map(([day, ...also], n) =>
        add(number, start + n * 5, start + n * 5 + 4, { day, alsoDays: also })
      )
    );
    const saved = await db.mst_session.findMany({
      where: {
        periodId: data.period.id,
        room: ROOM,
        day: { in: MANY_DAYS },
        number,
      },
    });
    check(
      `3 permintaan Sesi ${number} untuk Senin–Rabu dengan urutan hari berbeda: tepat satu berhasil, tanpa macet`,
      succeeded(results) === 1 &&
        results.filter(
          (r) => r.code === 409 && r.message.endsWith(`${ROOM} sudah ada!`)
        ).length === 2,
      summary(results)
    );
    check(
      "  tiap hari punya tepat satu sesi itu, semuanya dari permintaan yang menang",
      saved.length === 3 &&
        new Set(saved.map((session) => session.day)).size === 3 &&
        new Set(saved.map((session) => session.startAt)).size === 1,
      JSON.stringify(saved.map((s) => `${s.day} ${s.startAt}`))
    );
  }
  const sameNumber = (day) =>
    db.mst_session.findFirst({
      where: { ...placeOf(day), number: spread.free[0] },
    });
  const mondayOne = await sameNumber("MONDAY");
  const tuesdayOne = await sameNumber("TUESDAY");
  const crossed = await together([
    update(mondayOne, {
      startAt: "22.30",
      endAt: "22.45",
      alsoDays: ["TUESDAY"],
    }),
    update(tuesdayOne, {
      startAt: "22.30",
      endAt: "22.50",
      alsoDays: ["MONDAY"],
    }),
  ]);
  const [mondayAfter, tuesdayAfter] = await Promise.all(
    [mondayOne, tuesdayOne].map((session) =>
      db.mst_session.findUnique({ where: { id: session.id } })
    )
  );
  check(
    "Senin (ikut Selasa) dan Selasa (ikut Senin) diubah bersamaan: keduanya berhasil bergantian, hasil akhirnya sama di kedua hari",
    succeeded(crossed) === 2 &&
      mondayAfter.endAt === tuesdayAfter.endAt &&
      ["22.45", "22.50"].includes(mondayAfter.endAt),
    `${summary(crossed)} senin ${mondayAfter.endAt} selasa ${tuesdayAfter.endAt}`
  );
  check(
    "  tidak ada jam sesi yang tumpang tindih di Senin–Rabu",
    (
      await Promise.all(MANY_DAYS.map((day) => overlapping(placeOf(day))))
    ).every((pairs) => pairs === 0)
  );
  await clear();

  section("Kelas yang sudah dihapus");
  const [busyOne, unused, shared] = await data.sessions();
  const subject = await data.subject("Uji Sesi Kelas Terhapus");
  const live = await data.classOf(subject, "A", "MONDAY", 1);
  const goneAlone = await data.classOf(subject, "B", "MONDAY", 2);
  const liveShared = await data.classOf(subject, "C", "MONDAY", 3);
  const goneShared = await data.classOf(subject, "D", "MONDAY", 3);
  for (const removed of [goneAlone, goneShared])
    await db.mst_class.update({
      where: { id: removed.id },
      data: { deletedAt: new Date() },
    });

  const listed = (await call("GET", "/session", { token })).json.data;
  const countOf = (session) =>
    listed.find((item) => item.id === session.id)?.classes;
  check(
    "GET /session menghitung kelas yang masih ada saja (0 dan 1)",
    countOf(unused) === 0 && countOf(shared) === 1,
    JSON.stringify({ unused: countOf(unused), shared: countOf(shared) })
  );
  const removeUnused = await call("DELETE", `/session/${unused.id}`, { token });
  all.push(removeUnused);
  check(
    "sesi yang kelasnya sudah dihapus semua bisa dihapus",
    removeUnused.code === 200 &&
      removeUnused.message === `Sesi ${unused.number} Senin PSI berhasil dihapus`,
    `${removeUnused.code} ${removeUnused.message}`
  );
  const orphan = await db.mst_class.findUnique({ where: { id: goneAlone.id } });
  check(
    "  kelas terhapusnya tetap ada dengan jamnya sendiri, tanpa sesi",
    orphan?.sessionId === null &&
      orphan.startAt === goneAlone.startAt &&
      orphan.endAt === goneAlone.endAt,
    JSON.stringify(orphan)
  );
  const removeBusy = await call("DELETE", `/session/${busyOne.id}`, { token });
  all.push(removeBusy);
  check(
    "sesi yang masih dipakai kelas tetap tidak bisa dihapus",
    removeBusy.code === 409 &&
      removeBusy.message ===
        `Sesi ${busyOne.number} Senin PSI dipakai 1 kelas. Nonaktifkan saja agar tidak muncul di pilihan kelas baru.` &&
      !!(await db.mst_class.findUnique({ where: { id: live.id } }))?.sessionId,
    `${removeBusy.code} ${removeBusy.message}`
  );
  const newStart = at(toMinutes(shared.startAt) + 5);
  const moved = await update(shared, { startAt: newStart });
  all.push(moved);
  check(
    "ubah jam sesi dengan 1 kelas aktif dan 1 kelas terhapus: pesan menyebut 1 kelas",
    moved.code === 200 &&
      moved.message ===
        `Sesi ${shared.number} Senin PSI berhasil diperbarui; jam 1 kelas ikut berubah`,
    `${moved.code} ${moved.message}`
  );
  const [movedLive, keptGone] = await Promise.all(
    [liveShared, goneShared].map((item) =>
      db.mst_class.findUnique({ where: { id: item.id } })
    )
  );
  check(
    "  jam kelas aktif ikut berubah, kelas terhapus tetap jam lamanya",
    movedLive?.startAt === newStart && keptGone?.startAt === shared.startAt,
    JSON.stringify({ live: movedLive?.startAt, gone: keptGone?.startAt })
  );

  check(
    `tidak ada error server dari ${all.length} permintaan`,
    all.every((r) => r.code < 500),
    summary(all.filter((r) => r.code >= 500))
  );
});
