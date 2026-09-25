import db from "../../prisma/client.prisma";
import { ConflictError } from "../HttpErrors/HttptErrors";
import { formatSchedule, isScheduleClash } from "../Schedule/schedule";

interface IClassSchedule {
  name: string;
  day: string;
  startAt: string;
  endAt: string;
  subject: { subject_name: string };
}

const findAssistedClasses = async (userId: string) =>
  (
    await db.trn_class_collaborator.findMany({
      where: { userId, deletedAt: null, class: { deleted_at: null } },
      select: {
        class: {
          select: {
            name: true,
            subjectId: true,
            day: true,
            startAt: true,
            endAt: true,
            subject: { select: { subject_name: true } },
          },
        },
      },
    })
  ).map((row) => row.class);

export const assertNotAssistantOfSubjects = async (
  userId: string,
  subjectIds: string[]
) => {
  const assisted = (await findAssistedClasses(userId)).find((assistedClass) =>
    subjectIds.includes(assistedClass.subjectId)
  );

  if (assisted)
    throw new ConflictError(
      `Anda adalah asisten praktikum ${assisted.subject.subject_name} kelas ${assisted.name}, jadi tidak bisa mendaftar sebagai praktikan mata kuliah ini.`
    );
};

export const assertNoAssistantScheduleClash = async (
  userId: string,
  targets: IClassSchedule[],
  holder: string
) => {
  const assisted = await findAssistedClasses(userId);

  for (const target of targets) {
    const clash = assisted.find((assistedClass) =>
      isScheduleClash(assistedClass, target)
    );

    if (clash)
      throw new ConflictError(
        `Jadwal bentrok: ${target.subject.subject_name} kelas ${target.name} (${formatSchedule(target)}) bersamaan dengan ${clash.subject.subject_name} kelas ${clash.name} yang ${holder} sebagai asisten.`
      );
  }
};

const classSchedule = {
  select: {
    name: true,
    day: true,
    startAt: true,
    endAt: true,
    subject: { select: { subject_name: true } },
  },
};

export const assertNoMemberScheduleClash = async (
  classId: string,
  schedule: { day: string; startAt: string; endAt: string }
) => {
  const elsewhere = { classId: { not: classId }, class: { deleted_at: null } };
  const assistingElsewhere = {
    where: { ...elsewhere, deletedAt: null },
    select: { class: classSchedule },
  };

  const [assistants, participants] = await Promise.all([
    db.trn_class_collaborator.findMany({
      where: { classId, deletedAt: null },
      select: {
        user: {
          select: {
            fullname: true,
            classEnrollments: {
              where: { ...elsewhere, deleted_at: null },
              select: { class: classSchedule },
            },
            trn_class_collaborator: assistingElsewhere,
          },
        },
      },
    }),
    db.trn_class_participants.findMany({
      where: { classId, deleted_at: null },
      select: {
        user: {
          select: {
            fullname: true,
            trn_class_collaborator: assistingElsewhere,
          },
        },
      },
    }),
  ]);

  const commitments = [
    ...assistants.flatMap(({ user }) => [
      ...user.classEnrollments.map((row) => ({
        member: `asisten ${user.fullname}`,
        activity: "mengikuti praktikum",
        ...row.class,
      })),
      ...user.trn_class_collaborator.map((row) => ({
        member: `asisten ${user.fullname}`,
        activity: "menjadi asisten",
        ...row.class,
      })),
    ]),
    ...participants.flatMap(({ user }) =>
      user.trn_class_collaborator.map((row) => ({
        member: `peserta ${user.fullname}`,
        activity: "menjadi asisten",
        ...row.class,
      }))
    ),
  ];

  const clash = commitments.find((commitment) =>
    isScheduleClash(commitment, schedule)
  );

  if (clash)
    throw new ConflictError(
      `Jadwal baru bentrok: ${clash.member} ${clash.activity} ${clash.subject.subject_name} kelas ${clash.name} (${formatSchedule(clash)}).`
    );
};
