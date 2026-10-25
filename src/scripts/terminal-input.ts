import readline from "readline";
import {
  hasWhitespace,
  MIN_PASSWORD_LENGTH,
} from "../utils/PasswordRules/password.rules";

const pipedLines = process.stdin.isTTY
  ? null
  : readline
      .createInterface({ input: process.stdin, terminal: false })
      [Symbol.asyncIterator]();

const readPipedLine = async () => {
  const { value, done } = await pipedLines!.next();
  process.stdout.write("\n");
  return done ? null : String(value);
};

export const ask = async (question: string) => {
  if (pipedLines) {
    process.stdout.write(question);
    return ((await readPipedLine()) ?? "").trim();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (
      await new Promise<string>((resolve) => {
        rl.once("close", () => resolve(""));
        rl.question(question, resolve);
      })
    ).trim();
  } finally {
    rl.close();
  }
};

export const askHidden = async (question: string) => {
  if (pipedLines) {
    process.stdout.write(question);
    return readPipedLine();
  }

  const stdin = process.stdin;

  return new Promise<string | null>((resolve) => {
    let value = "";

    const finish = (result: string | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish(value);
        if (char === "\u0003" || char === "\u0004") return finish(null);

        if (char === "\u007f" || char === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        value += char;
        process.stdout.write("*");
      }
    };

    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
    process.stdout.write(question);
  });
};

export const askNewPassword = async (cancelled: string) => {
  const password = await askHidden("Password baru: ");

  if (password === null) {
    console.log(cancelled);
    return null;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.log(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter. ${cancelled}`
    );
    return null;
  }

  if (hasWhitespace(password)) {
    console.log(`Password tidak boleh mengandung spasi. ${cancelled}`);
    return null;
  }

  const repeated = await askHidden("Ulangi password baru: ");

  if (repeated === null) {
    console.log(cancelled);
    return null;
  }

  if (repeated !== password) {
    console.log(`Password tidak sama. ${cancelled}`);
    return null;
  }

  return password;
};
