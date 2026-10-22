import { db, TestData } from "../bantuan/data.mjs";
import { call, check, login, runTest, section } from "../bantuan/uji.mjs";

const data = new TestData("29");

await runTest("Tambah dan ubah mata kuliah bersamaan", data, async () => {
  const token = (await login(data.laboran, data.password)).token;
  const all = [];

  const together = async (requests) => {
    const results = await Promise.all(requests);
    all.push(...results);
    return results;
  };
  const add = (body) =>
    call("POST", "/subject", {
      token,
      body: { semester: "2", lecturer_id: data.lecturer.id, ...body },
    });
  const update = (subject, body) =>
    call("PUT", `/subject/${subject.id}`, { token, body });
  const summary = (results) =>
    JSON.stringify(results.map((r) => `${r.code} ${r.message}`));
  const succeeded = (results) =>
    results.filter((r) => r.code === 200 || r.code === 201).length;
  const countSubjects = (where) =>
    db.mst_subject.count({ where: { deleted_at: null, ...where } });
  const sameName = (name) => ({
    subject_name: { equals: name, mode: "insensitive" },
  });

  section("Kode yang sama dikirim bersamaan");
  for (const round of [1, 2, 3]) {
    const code = data.nextCode();
    const results = await together(
      [1, 2, 3, 4].map((n) =>
        add({ subject_code: code, subject_name: `Uji Kode Sama ${round}-${n}` })
      )
    );
    check(
      `4 mata kuliah berkode ${code} bersamaan: tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Kode ${code} sudah dipakai mata kuliah ..."`,
      results.filter(
        (r) =>
          r.code === 409 &&
          r.message.startsWith(`Kode ${code} sudah dipakai mata kuliah `)
      ).length === 3,
      summary(results)
    );
    const saved = await countSubjects({ subject_code: code });
    check(`  kode ${code} tersimpan tepat satu (${saved})`, saved === 1);
  }

  section("Nama yang sama dikirim bersamaan");
  for (const name of ["Uji Nama Sama Satu", "Uji Nama Sama Dua"]) {
    const results = await together(
      [1, 2, 3, 4].map((n) =>
        add({
          subject_code: data.nextCode(),
          subject_name: n % 2 === 0 ? name.toLowerCase() : name,
        })
      )
    );
    check(
      `4 mata kuliah bernama ${name} bersamaan (huruf besar-kecil berbeda): tepat satu berhasil`,
      succeeded(results) === 1,
      summary(results)
    );
    check(
      `  sisanya 409 "Nama ... sudah dipakai mata kuliah berkode ..."`,
      results.filter(
        (r) =>
          r.code === 409 &&
          / sudah dipakai mata kuliah berkode \d{9}!$/.test(r.message)
      ).length === 3,
      summary(results)
    );
    const saved = await countSubjects(sameName(name));
    check(`  nama ${name} tersimpan tepat satu (${saved})`, saved === 1);
  }

  section("Ubah bersamaan");
  const first = await data.subject("Uji Ubah Bersamaan Satu");
  const second = await data.subject("Uji Ubah Bersamaan Dua");
  const renames = await together([
    update(first, { subject_name: "Uji Nama Baru Sama" }),
    update(second, { subject_name: "Uji Nama Baru Sama" }),
  ]);
  check(
    "dua mata kuliah diganti ke nama yang sama bersamaan: tepat satu berhasil",
    succeeded(renames) === 1 && renames.some((r) => r.code === 409),
    summary(renames)
  );
  const renamed = await countSubjects(sameName("Uji Nama Baru Sama"));
  check(`  nama itu dipakai tepat satu (${renamed})`, renamed === 1);

  const newCode = data.nextCode();
  const recodes = await together([
    update(first, { subject_code: newCode }),
    update(second, { subject_code: newCode }),
  ]);
  check(
    "dua mata kuliah diganti ke kode yang sama bersamaan: tepat satu berhasil",
    succeeded(recodes) === 1 && recodes.some((r) => r.code === 409),
    summary(recodes)
  );
  const recoded = await countSubjects({ subject_code: newCode });
  check(`  kode itu dipakai tepat satu (${recoded})`, recoded === 1);

  section("Tambah dan ubah bersamaan");
  const third = await data.subject("Uji Ubah Bersamaan Tiga");
  const mixed = await together([
    add({ subject_code: data.nextCode(), subject_name: "Uji Nama Rebutan" }),
    update(third, { subject_name: "Uji Nama Rebutan" }),
  ]);
  check(
    "mata kuliah baru dan ganti nama ke nama yang sama bersamaan: tepat satu berhasil",
    succeeded(mixed) === 1,
    summary(mixed)
  );
  const contested = await countSubjects(sameName("Uji Nama Rebutan"));
  check(`  nama itu dipakai tepat satu (${contested})`, contested === 1);

  check(
    `tidak ada error server dari ${all.length} permintaan`,
    all.every((r) => r.code < 500),
    summary(all.filter((r) => r.code >= 500))
  );
});
