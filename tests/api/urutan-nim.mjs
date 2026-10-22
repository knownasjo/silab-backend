import { TestData } from "../bantuan/data.mjs";
import { call, check, login, runTest } from "../bantuan/uji.mjs";

const data = new TestData("28");

await runTest("Urutan mahasiswa di daftar presensi", data, async () => {
  const subject = await data.subject("Uji Urutan NIM");
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const students = await data.students(6);
  for (const index of [3, 0, 5, 1, 4, 2])
    await data.enroll(students[index], cls);
  const first = await data.meeting(cls, "Pertemuan 1");
  await data.meeting(cls, "Pertemuan 2");
  await data.attend(first, students[4], true);
  const sorted = JSON.stringify(students.map((student) => student.nim));

  for (const [label, user] of [
    ["laboran", data.laboran],
    ["dosen pengampu", data.lecturer],
  ]) {
    const token = (await login(user, data.password)).token;
    const res = await call("GET", `/meeting/${cls.id}`, { token });
    const lists = (res.json.data ?? []).map((meeting) =>
      meeting.students.map((student) => student.nim)
    );
    check(
      `${label}: mahasiswa di tiap pertemuan urut NIM, bukan urutan masuk kelas`,
      res.code === 200 &&
        lists.length === 2 &&
        lists.every((nims) => JSON.stringify(nims) === sorted),
      JSON.stringify(lists)
    );
  }
});
