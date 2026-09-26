import { Prisma } from "@prisma/client";
import db from "../../prisma/client.prisma";
import { ConflictError } from "../HttpErrors/HttptErrors";
import { formatSchedule, isScheduleClash } from "../Schedule/schedule";

interface IEnrollTarget {
  id: string;
  name: string;
  day: string;
  startAt: string;
  endAt: string;
  quota: number;
  subject: { subject_name: string };
}

export const enrollInClasses = <T>(
  userIds: string[],
  classIds: string[],
  work: (tx: Prisma.TransactionClient) => Promise<T>
) =>
  db.$transaction(
    async (tx) => {
      const keys = [
        ...userIds.map((id) => `enroll:user:${id}`),
        ...classIds.map((id) => `enroll:class:${id}`),
      ];

      for (const key of [...new Set(keys)].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

      return work(tx);
    },
    { maxWait: 10000, timeout: 20000 }
  );

export const findFullClass = async <C extends IEnrollTarget>(
  tx: Prisma.TransactionClient,
  classes: C[]
) => {
  for (const target of classes) {
    const taken = await tx.trn_class_participants.count({
      where: { classId: target.id, deleted_at: null },
    });

    if (taken >= target.quota) return target;
  }

  return undefined;
};

export const findEnrollmentInSubjects = (
  tx: Prisma.TransactionClient,
  userId: string,
  subjectIds: string[],
  exceptClassId?: string
) =>
  tx.trn_class_participants.findFirst({
    where: {
      userId,
      deleted_at: null,
      class: { subjectId: { in: subjectIds }, deleted_at: null },
      ...(exceptClassId && { classId: { not: exceptClassId } }),
    },
    include: {
      class: { include: { subject: { select: { subject_name: true } } } },
    },
  });

export const assertNoParticipantScheduleClash = async (
  tx: Prisma.TransactionClient,
  userId: string,
  targets: IEnrollTarget[],
  holder: string,
  exceptClassId?: string
) => {
  const enrolled = (
    await tx.trn_class_participants.findMany({
      where: {
        userId,
        deleted_at: null,
        class: { deleted_at: null },
        ...(exceptClassId && { classId: { not: exceptClassId } }),
      },
      select: {
        class: {
          select: {
            id: true,
            name: true,
            day: true,
            startAt: true,
            endAt: true,
            subject: { select: { subject_name: true } },
          },
        },
      },
    })
  ).map((row) => row.class);

  targets.forEach((target, index) => {
    const clash = enrolled.find(
      (current) => current.id !== target.id && isScheduleClash(current, target)
    );

    if (clash)
      throw new ConflictError(
        `Jadwal bentrok: ${target.subject.subject_name} kelas ${target.name} (${formatSchedule(target)}) bersamaan dengan ${clash.subject.subject_name} kelas ${clash.name} yang ${holder}.`
      );

    const picked = targets
      .slice(0, index)
      .find((other) => isScheduleClash(other, target));

    if (picked)
      throw new ConflictError(
        `Jadwal bentrok: ${target.subject.subject_name} kelas ${target.name} (${formatSchedule(target)}) bersamaan dengan ${picked.subject.subject_name} kelas ${picked.name} yang juga dipilih.`
      );
  });
};
