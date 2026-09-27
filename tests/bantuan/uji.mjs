import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  changedTables,
  countAllTestData,
  db,
  snapshotRealData,
} from "./data.mjs";

export const API = (process.env.SILAB_API ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

const result = { passed: 0, failed: 0 };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const check = (label, ok, detail = "") => {
  if (ok) result.passed++;
  else result.failed++;
  const note = !ok && detail !== "" ? ` -> ${detail}` : "";
  console.log(`${ok ? "LULUS" : "GAGAL"} ${label}${note}`);
  return ok;
};

export const expect = (label, res, code, message) =>
  check(
    label,
    res.code === code && (message === undefined || res.message === message),
    `${res.code} ${JSON.stringify(res.message)}`
  );

export const section = (title) => console.log(`\n-- ${title}`);

export const call = async (
  method,
  path,
  { token, body, raw, contentType, headers = {}, timeout } = {}
) => {
  const allHeaders = { ...headers };
  if (token) allHeaders.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    allHeaders["Content-Type"] = contentType ?? "text/plain";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    allHeaders["Content-Type"] = "application/json";
  }
  const started = performance.now();
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: allHeaders,
      body: payload,
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      code: res.status,
      json: json ?? {},
      isJson:
        json !== null &&
        (res.headers.get("content-type") ?? "").includes("json"),
      message: json?.message ?? text.slice(0, 80).replace(/\s+/g, " "),
      ms: performance.now() - started,
    };
  } catch (error) {
    const timedOut = error.name === "TimeoutError";
    return {
      code: 0,
      json: {},
      isJson: false,
      timedOut,
      message: timedOut
        ? `tidak dijawab dalam ${timeout / 1000} dtk`
        : (error.cause?.code ?? error.message),
      ms: performance.now() - started,
    };
  }
};

export const login = async (user, password) => {
  const res = await call("POST", "/auth/login", {
    body: { nim: user.nim ?? user, password },
  });
  if (!res.json.data?.accessToken)
    throw new Error(`Login ${user.nim ?? user} gagal: ${res.message}`);
  return {
    token: res.json.data.accessToken,
    refreshToken: res.json.data.refreshToken,
  };
};

export const listenEvents = async (token, onEvent) => {
  const abort = new AbortController();
  const res = await fetch(`${API}/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal: abort.signal,
  });
  if (res.status !== 200) throw new Error(`SSE dibalas ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));
  const stream = { dropped: false, close: () => abort.abort() };
  (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let type = "message";
          let data = "{}";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (type === "ready") markReady();
          else if (type !== "ping") onEvent(type, JSON.parse(data));
        }
      }
    } catch {}
    if (!abort.signal.aborted) stream.dropped = true;
  })();
  await ready;
  return stream;
};

export const ensureBackend = async () => {
  const res = await call("GET", "/", { timeout: 10000 });
  if (res.code === 200) return;
  console.error(
    `Backend tidak bisa dihubungi di ${API} (${res.message}).\n` +
      "Jalankan backend dulu dengan npm run dev, atau atur alamatnya lewat SILAB_API."
  );
  await db.$disconnect();
  process.exit(1);
};

export const runTest = async (title, data, body) => {
  console.log(`== ${title}`);
  await ensureBackend();
  const realBefore = await snapshotRealData();
  try {
    await data.start();
    await body();
  } catch (error) {
    check("tes berjalan sampai selesai", false, error.stack ?? error.message);
  } finally {
    await finish(data, realBefore);
  }
};

export const finish = async (data, realBefore) => {
  section("Pembersihan");
  const left = await data.cleanup();
  check("data uji dihapus semua", left === 0, `sisa ${left}`);
  const changed = changedTables(realBefore, await snapshotRealData());
  check(
    "data asli (di luar data uji) tidak berubah",
    changed.length === 0,
    `berubah: ${changed.join(", ")} (bisa juga karena ada pengguna lain yang sedang memakai aplikasi)`
  );
  await db.$disconnect();
  const total = result.passed + result.failed;
  console.log(`\n${result.passed}/${total} lulus`);
  process.exitCode = result.failed ? 1 : 0;
};

const runFile = (file) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    child.on("close", (code) => {
      const [, passed, total] = output.match(/(\d+)\/(\d+) lulus\s*$/) ?? [];
      resolve({ code, passed: Number(passed ?? 0), total: Number(total ?? 0) });
    });
  });

export const runSuite = async (dir, filters, prepare) => {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".mjs") && file !== "jalankan.mjs")
    .filter((file) => !filters.length || filters.some((f) => file.includes(f)))
    .sort();
  if (!files.length) {
    console.error(`Tidak ada tes yang cocok dengan: ${filters.join(", ")}`);
    process.exit(1);
  }
  await prepare();

  const started = Date.now();
  const results = [];
  for (const file of files) {
    results.push({ file, ...(await runFile(join(dir, file))) });
    console.log("");
  }
  const left = await countAllTestData();
  await db.$disconnect();

  console.log("== Ringkasan");
  for (const r of results) {
    const name = r.file.replace(".mjs", "").padEnd(28);
    console.log(
      `${r.code === 0 ? "LULUS" : "GAGAL"} ${name} ${r.passed}/${r.total}`
    );
  }
  const sum = (key) => results.reduce((total, r) => total + r[key], 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\nTotal: ${sum("passed")}/${sum("total")} cek lulus dari ${results.length} tes, ${seconds} detik`
  );
  console.log(
    left === 0
      ? "Data uji sudah bersih."
      : `PERHATIAN: masih ada ${left} data uji tersisa.`
  );
  process.exitCode = results.some((r) => r.code !== 0) || left ? 1 : 0;
};

export { countAllTestData };
