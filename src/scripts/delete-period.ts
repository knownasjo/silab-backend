import dotenv from "dotenv";
dotenv.config({ quiet: true });

import readline from "readline/promises";
import { AcademicTerm, mst_academic_period, Prisma } from "@prisma/client";
import db from "../prisma/client.prisma";
import {
  findActivePeriod,
  LATEST_PERIOD_FIRST,
  periodLabel,
} from "../utils/PeriodRules/period.rules";

const CONFIRM_WORD = "HAPUS";
const USAGE = 'Cara pakai: npm run hapus-periode "2026/2027 Ganjil"';

const ask = async (question: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const closed = new Promise<string>((resolve) =>
    rl.once("close", () => resolve(""))
  );

  try {
    return (await Promise.race([rl.question(question), closed])).trim();
  } finally {
    rl.close();
  }
};

const confirmDeletion = async () => {
  const answer = await ask(
    `\nPenghapusan tidak bisa dibatalkan. Ketik ${CONFIRM_WORD} untuk melanjutkan: `
  );

  if (answer === CONFIRM_WORD) return true;

  console.log("\nDibatalkan, tidak ada data yang dihapus.");
  return false;
};

const formatCount = (count: number) => count.toLocaleString("id-ID");

const parseName = (name: string) => {
  const match = /^(\d{4}\/\d{4})\s+(ganjil|genap)$/i.exec(name);

  return match
    ? { year: match[1], term: match[2].toUpperCase() as AcademicTerm }
    : null;
};

const printPeriods = async () => {
  const periods = await db.mst_academic_period.findMany({
    orderBy: LATEST_PERIOD_FIRST,
  });

  if (!periods.length) {
    console.log("Belum ada periode akademik.");
    return;
  }

  console.log("\nPeriode yang ada:");
  periods.forEach((period, index) =>
    console.log(`  ${periodLabel(period)}${index === 0 ? " (aktif)" : ""}`)
  );
};

const countPeriodData = async (period: mst_academic_period) => {
  const inPeriod = { periodId: period.id };
  const inClasses = { class: inPeriod };
  const [
    classes,
    meetings,
    attendances,
    participants,
    assistants,
    activations,
    paid,
    sessions,
  ] = await Promise.all([
    db.mst_class.count({ where: inPeriod }),
    db.trn_meetings.count({ where: inClasses }),
    db.trn_meeting_participants.count({ where: { meeting: inClasses } }),
    db.trn_class_participants.count({ where: inClasses }),
    db.trn_class_collaborator.count({ where: inClasses }),
    db.trn_activations.count({ where: inPeriod }),
    db.trn_activations.count({ where: { ...inPeriod, status: true } }),
    db.mst_session.count({ where: inPeriod }),
  ]);

  return {
    classes,
    meetings,
    attendances,
    participants,
    assistants,
    activations,
    paid,
    sessions,
  };
};

const deletePeriodData = (period: mst_academic_period) =>
  db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('academic-period'))`;

      const active = await findActivePeriod(tx);

      if (active?.id === period.id)
        throw new Error(
          `periode ${periodLabel(period)} sekarang menjadi periode aktif.`
        );

      const inPeriod = { periodId: period.id };
      const inClasses = { class: inPeriod };

      await tx.trn_meeting_participants.deleteMany({
        where: { meeting: inClasses },
      });
      await tx.trn_meetings.deleteMany({ where: inClasses });
      await tx.trn_class_participants.deleteMany({ where: inClasses });
      await tx.trn_class_collaborator.deleteMany({ where: inClasses });
      await tx.mst_class.deleteMany({ where: inPeriod });
      await tx.trn_activations.deleteMany({ where: inPeriod });
      await tx.mst_academic_period.delete({ where: { id: period.id } });
    },
    { maxWait: 10_000, timeout: 120_000 }
  );

const deleteActivePeriod = async (
  period: mst_academic_period,
  counts: Awaited<ReturnType<typeof countPeriodData>>
) => {
  if (counts.classes || counts.activations) {
    console.log(
      `Periode ${periodLabel(
        period
      )} sedang aktif dan sudah berisi ${formatCount(
        counts.classes
      )} kelas dan ${formatCount(
        counts.activations
      )} pendaftaran mata kuliah, jadi tidak bisa dihapus.`
    );
    return 1;
  }

  const previous = await db.mst_academic_period.findFirst({
    where: { id: { not: period.id } },
    orderBy: LATEST_PERIOD_FIRST,
  });

  console.log(
    `Periode yang akan dihapus: ${periodLabel(period)} (aktif, masih kosong)`
  );
  console.log(
    previous
      ? `Setelah dihapus, periode ${periodLabel(
          previous
        )} aktif kembali dan bisa diubah lagi.\nJam sesi semester ini (${formatCount(
          counts.sessions
        )}) ikut terhapus, dan jam sesi ${periodLabel(
          previous
        )} dipakai lagi.\nSesi presensi yang ditutup saat semester ini dimulai tetap tertutup.`
      : "Setelah dihapus, belum ada periode akademik; laboran perlu memulai periode pertama lagi."
  );

  if (!(await confirmDeletion())) return 1;

  try {
    await db.mst_academic_period.delete({ where: { id: period.id } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      console.log(
        `\nPeriode ${periodLabel(
          period
        )} baru saja diisi kelas atau pendaftaran, jadi tidak dihapus.`
      );
      return 1;
    }
    throw error;
  }

  console.log(
    `\nPeriode ${periodLabel(period)} sudah dihapus.${
      previous ? ` Periode aktif sekarang ${periodLabel(previous)}.` : ""
    }`
  );
  return 0;
};

const deletePeriod = async (name: string) => {
  const parsed = parseName(name);

  if (!parsed) {
    console.log(`Nama periode "${name}" tidak dikenali. ${USAGE}`);
    await printPeriods();
    return 1;
  }

  const period = await db.mst_academic_period.findUnique({
    where: { year_term: parsed },
  });

  if (!period) {
    console.log(`Periode ${periodLabel(parsed)} tidak ditemukan.`);
    await printPeriods();
    return 1;
  }

  const [active, counts] = await Promise.all([
    findActivePeriod(),
    countPeriodData(period),
  ]);

  if (active?.id === period.id) return deleteActivePeriod(period, counts);

  console.log(`Periode yang akan dihapus: ${periodLabel(period)}`);
  console.log("\nData yang ikut terhapus:");
  console.log(`  Kelas praktikum         : ${formatCount(counts.classes)}`);
  console.log(`  Pertemuan               : ${formatCount(counts.meetings)}`);
  console.log(`  Riwayat presensi        : ${formatCount(counts.attendances)}`);
  console.log(
    `  Peserta kelas           : ${formatCount(counts.participants)}`
  );
  console.log(`  Asisten kelas           : ${formatCount(counts.assistants)}`);
  console.log(
    `  Pendaftaran mata kuliah : ${formatCount(
      counts.activations
    )} (${formatCount(counts.paid)} lunas)`
  );
  console.log(`  Jam sesi                : ${formatCount(counts.sessions)}`);
  console.log("\nTetap tersimpan: akun, mata kuliah, dan pengumuman.");

  if (!(await confirmDeletion())) return 1;

  await deletePeriodData(period);

  console.log(
    `\nPeriode ${periodLabel(period)} dan seluruh datanya sudah dihapus.`
  );
  return 0;
};

const main = async () => {
  const name = process.argv.slice(2).join(" ").trim().replace(/\s+/g, " ");

  if (!name) {
    console.log(USAGE);
    await printPeriods();
    return 1;
  }

  return deletePeriod(name);
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Gagal, tidak ada data yang dihapus:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
