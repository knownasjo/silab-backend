import { fileURLToPath } from "node:url";
import { ensureBackend, runSuite } from "./bantuan/uji.mjs";

await runSuite(
  fileURLToPath(new URL("./api/", import.meta.url)),
  process.argv.slice(2),
  ensureBackend
);
