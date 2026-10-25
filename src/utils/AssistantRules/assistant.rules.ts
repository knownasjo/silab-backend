import { Prisma } from "@prisma/client";
import db from "../../prisma/client.prisma";
import { periodsOf } from "../EnrollmentRules/enrollment.rules";
import { ConflictError } from "../HttpErrors/HttptErrors";
import { formatSchedule, isScheduleClash } from "../Schedule/schedule";

interface IClassSchedule {
  name: string;
  day: string;
  startAt: string;
  endAt: string;
  periodId: string;
  subject: { subjectName: string };
}

const findAssistedClasses = async (
  userId: string,
  periodIds: string[],
  client: Prisma.TransactionClient = db
) =>
  (
    await client.trn_class_collaborator.findMany({
      where: {
        userId,
        deletedAt: null,
        class: { deletedAt: null, periodId: { in: periodIds } },
      },
      select: {
        class: {
          select: {
            name: true,
            subjectId: true,
            day: true,
            startAt: true,
            endAt: true,
            subject: { select: { subjectName: true } },
          },
        },
      },
    })
  ).map((row) => row.class);

export const assertNotAssistantOfSubjects = async (
  userId: string,
  subjectIds: string[],
  periodId: string
) => {
  const assisted = (await findAssistedClasses(userId, [periodId])).find(
    (assistedClass) => subjectIds.includes(assistedClass.subjectId)
  );

  if (assisted)
    throw new ConflictError(
      `Anda adalah asisten praktikum ${assisted.subject.subjectName} kelas ${assisted.name}, jadi tidak bisa mendaftar sebagai praktikan mata kuliah ini.`
    );
};

export const assertNoAssistantScheduleClash = async (
  userId: string,
  targets: IClassSchedule[],
  holder: string,
  client: Prisma.TransactionClient = db
) => {
  const assisted = await findAssistedClasses(
    userId,
    periodsOf(targets),
    client
  );

  for (const target of targets) {
    const clash = assisted.find((assistedClass) =>
      isScheduleClash(assistedClass, target)
    );

    if (clash)
      throw new ConflictError(
        `Jadwal bentrok: ${target.subject.subjectName} kelas ${target.name} (${formatSchedule(target)}) bersamaan dengan ${clash.subject.subjectName} kelas ${clash.name} yang ${holder} sebagai asisten.`
      );
  }
};

const classSchedule = {
  select: {
    name: true,
    day: true,
    room: true,
    startAt: true,
    endAt: true,
    subject: { select: { subjectName: true } },
  },
};

export const findMemberScheduleClashes = async (
  classId: string,
  schedule: { day: string; startAt: string; endAt: string },
  periodId: string,
  client: Prisma.TransactionClient = db
) => {
  const elsewhere = {
    classId: { not: classId },
    class: { deletedAt: null, periodId },
  };
  const assistingElsewhere = {
    where: { ...elsewhere, deletedAt: null },
    select: { class: classSchedule },
  };

  const assistants = await client.trn_class_collaborator.findMany({
    where: { classId, deletedAt: null },
    select: {
      user: {
        select: {
          fullname: true,
          classEnrollments: {
            where: { ...elsewhere, deletedAt: null },
            select: { class: classSchedule },
          },
          classCollaborators: assistingElsewhere,
        },
      },
    },
  });
  const participants = await client.trn_class_participants.findMany({
    where: { classId, deletedAt: null },
    select: {
      user: {
        select: {
          fullname: true,
          classEnrollments: {
            where: { ...elsewhere, deletedAt: null },
            select: { class: classSchedule },
          },
          classCollaborators: assistingElsewhere,
        },
      },
    },
  });

  const commitments = [
    ...assistants.flatMap(({ user }) => [
      ...user.classEnrollments.map((row) => ({
        member: `asisten ${user.fullname}`,
        activity: "mengikuti praktikum",
        ...row.class,
      })),
      ...user.classCollaborators.map((row) => ({
        member: `asisten ${user.fullname}`,
        activity: "menjadi asisten",
        ...row.class,
      })),
    ]),
    ...participants.flatMap(({ user }) => [
      ...user.classEnrollments.map((row) => ({
        member: `peserta ${user.fullname}`,
        activity: "mengikuti praktikum",
        ...row.class,
      })),
      ...user.classCollaborators.map((row) => ({
        member: `peserta ${user.fullname}`,
        activity: "menjadi asisten",
        ...row.class,
      })),
    ]),
  ];

  return commitments.filter((commitment) =>
    isScheduleClash(commitment, schedule)
  );
};

export const assertNoMemberScheduleClash = async (
  classId: string,
  schedule: { day: string; startAt: string; endAt: string },
  periodId: string,
  client: Prisma.TransactionClient = db
) => {
  const [clash] = await findMemberScheduleClashes(
    classId,
    schedule,
    periodId,
    client
  );

  if (clash)
    throw new ConflictError(
      `Jadwal baru bentrok: ${clash.member} ${clash.activity} ${clash.subject.subjectName} kelas ${clash.name} (${formatSchedule(clash)}).`
    );
};
