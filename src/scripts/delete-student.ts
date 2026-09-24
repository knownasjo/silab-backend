import dotenv from "dotenv";
dotenv.config({ quiet: true });

import readline from "readline/promises";
import { UserRole } from "@prisma/client";
import db from "../prisma/client.prisma";

const CONFIRM_WORD = "HAPUS";

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

const withNames = (names: string[]) =>
  names.length ? `${names.length} (${names.join(", ")})` : "0";

const formatDate = (date: Date) =>
  date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });

const deletePendingRegistration = async (keyword: string) => {
  const registration = await db.trn_registrations.findUnique({
    where: keyword.includes("@") ? { email: keyword } : { nim: keyword },
  });

  if (!registration) {
    console.log(`Tidak ada akun maupun pendaftaran dengan ${keyword}.`);
    return 1;
  }

  console.log(
    `Tidak ada akun dengan ${keyword}, tetapi ada pendaftaran yang belum diverifikasi:`
  );
  console.log(`  Nama   : ${registration.fullname}`);
  console.log(`  NIM    : ${registration.nim}`);
  console.log(`  Email  : ${registration.email}`);
  console.log(`  Dibuat : ${formatDate(registration.created_at)}`);

  if (!(await confirmDeletion())) return 1;

  await db.trn_registrations.delete({ where: { id: registration.id } });
  console.log(
    `\nPendaftaran ${registration.nim} yang belum diverifikasi sudah dihapus.`
  );
  return 0;
};

const deleteStudent = async (keyword: string) => {
  const user = await db.mst_user.findFirst({
    where: keyword.includes("@")
      ? { email: { equals: keyword, mode: "insensitive" } }
      : { nim: keyword },
  });

  if (!user) return deletePendingRegistration(keyword);

  if (user.role !== UserRole.MAHASISWA) {
    console.log(
      `Akun ${user.nim} (${user.fullname}) adalah ${user.role}. Script ini hanya untuk akun MAHASISWA.`
    );
    return 1;
  }

  const [subjects, announcements] = await Promise.all([
    db.mst_subject.count({
      where: {
        OR: [
          { lecturer_id: user.id },
          { created_by: user.id },
          { updated_by: user.id },
        ],
      },
    }),
    db.mst_announcement.count({ where: { author: user.id } }),
  ]);

  if (subjects || announcements) {
    console.log(
      `Akun ${user.nim} masih tercatat di ${subjects} mata kuliah (sebagai dosen, pembuat, atau pengubah) dan ${announcements} pengumuman. Pindahkan dulu data itu ke akun lain, lalu jalankan lagi script ini.`
    );
    return 1;
  }

  const where = { userId: user.id };
  const [activations, classes, attendances, assistedClasses] =
    await Promise.all([
      db.trn_activations.findMany({
        where,
        select: { subject: { select: { subject_name: true } } },
      }),
      db.trn_class_participants.findMany({
        where: { ...where, deleted_at: null },
        select: {
          class: {
            select: { name: true, subject: { select: { subject_name: true } } },
          },
        },
      }),
      db.trn_meeting_participants.count({ where }),
      db.trn_class_collaborator.findMany({
        where: { ...where, deletedAt: null },
        select: {
          class: {
            select: { name: true, subject: { select: { subject_name: true } } },
          },
        },
      }),
    ]);
  const className = ({
    class: item,
  }: {
    class: { name: string; subject: { subject_name: string } };
  }) => `${item.subject.subject_name} kelas ${item.name}`;

  console.log("Akun yang akan dihapus:");
  console.log(`  Nama   : ${user.fullname}`);
  console.log(`  NIM    : ${user.nim}`);
  console.log(`  Email  : ${user.email}`);
  console.log(`  Role   : ${user.role}`);
  console.log("\nData yang ikut terhapus:");
  console.log(
    `  Aktivasi mata kuliah : ${withNames(
      activations.map((activation) => activation.subject.subject_name)
    )}`
  );
  console.log(`  Kelas praktikum      : ${withNames(classes.map(className))}`);
  console.log(`  Riwayat presensi     : ${attendances}`);
  console.log(
    `  Asisten kelas        : ${withNames(assistedClasses.map(className))}`
  );

  if (!(await confirmDeletion())) return 1;

  await db.$transaction([
    db.trn_meeting_participants.deleteMany({ where }),
    db.trn_class_participants.deleteMany({ where }),
    db.trn_activations.deleteMany({ where }),
    db.trn_class_collaborator.deleteMany({ where }),
    db.trn_registrations.deleteMany({
      where: { OR: [{ email: user.email.toLowerCase() }, { nim: user.nim }] },
    }),
    db.mst_user.delete({ where: { id: user.id } }),
  ]);

  console.log(`\nAkun ${user.nim} dan seluruh datanya sudah dihapus.`);
  return 0;
};

const main = async () => {
  const keyword = (process.argv[2] ?? "").trim().toLowerCase();

  if (!keyword) {
    console.log("Cara pakai: npm run hapus-akun <NIM atau email>");
    return 1;
  }

  return deleteStudent(keyword);
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
