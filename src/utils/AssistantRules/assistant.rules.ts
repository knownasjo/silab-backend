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
