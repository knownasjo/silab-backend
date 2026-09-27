import { TestData } from "../bantuan/data.mjs";
import {
  call,
  check,
  listenEvents,
  login,
  runTest,
  sleep,
} from "../bantuan/uji.mjs";

const data = new TestData("19");

await runTest("Pembaruan real-time saat asisten diubah", data, async () => {
  const subject = await data.subject("Uji Event Asisten");
  const cls = await data.classOf(subject, "A", "MONDAY", 1);
  const student = await data.student();
  const laboran = (await login(data.laboran, data.password)).token;
  const events = [];
  const stream = await listenEvents(laboran, (type, payload) => {
    if (type === "class") events.push(payload);
  });
  const announced = () =>
    events.some((e) => e.class_id === cls.id && e.action === "assistants");

  try {
    const added = await call("POST", "/collaborator", {
      token: laboran,
      body: { classId: cls.id, collaborators: [student.id] },
    });
    await sleep(800);
    check(
      "tambah asisten berhasil",
      added.code < 300,
      `${added.code} ${added.message}`
    );
    check(
      "  event kelas membawa action assistants",
      announced(),
      JSON.stringify(events)
    );

    events.length = 0;
    const removed = await call(
      "DELETE",
      `/collaborator/${cls.id}/${student.id}`,
      {
        token: laboran,
      }
    );
    await sleep(800);
    check(
      "hapus asisten berhasil",
      removed.code < 300,
      `${removed.code} ${removed.message}`
    );
    check(
      "  event kelas membawa action assistants",
      announced(),
      JSON.stringify(events)
    );
  } finally {
    stream.close();
  }
});
