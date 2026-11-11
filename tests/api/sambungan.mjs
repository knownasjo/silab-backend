import { once } from "node:events";
import { connect } from "node:net";
import { TestData } from "../bantuan/data.mjs";
import { API, check, runTest, sleep } from "../bantuan/uji.mjs";

const data = new TestData("35");
const { hostname, port } = new URL(API);

const ask = (socket) =>
  new Promise((resolve) => {
    if (socket.destroyed) return resolve(null);
    let reply = "";
    const done = (statusLine) => {
      socket.off("data", read);
      socket.off("close", closed);
      resolve(statusLine);
    };
    const read = (chunk) => {
      reply += chunk;
      const end = reply.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = /^content-length: *(\d+)/im.exec(reply.slice(0, end));
      if (reply.length - end - 4 >= Number(length?.[1] ?? 0))
        done(reply.slice(0, reply.indexOf("\r\n")));
    };
    const closed = () => done(null);
    socket.on("data", read);
    socket.on("close", closed);
    socket.write(`GET / HTTP/1.1\r\nHost: ${hostname}:${port}\r\n\r\n`);
  });

await runTest("Sambungan HP yang menganggur dipakai lagi", data, async () => {
  const socket = connect(Number(port || 80), hostname);
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  await once(socket, "connect");

  try {
    const first = await ask(socket);
    check(
      "permintaan pertama dijawab 200",
      first?.startsWith("HTTP/1.1 200") ?? false,
      first ?? "sambungan ditutup"
    );

    await sleep(16_000);
    const second = await ask(socket);
    check(
      "sambungan yang menganggur 16 detik masih dijawab 200 (HP memakai ulang sambungan sampai 15 detik)",
      second?.startsWith("HTTP/1.1 200") ?? false,
      second ?? `sambungan sudah ditutup server ${API} sebelum detik ke-16`
    );
  } finally {
    socket.destroy();
  }
});
