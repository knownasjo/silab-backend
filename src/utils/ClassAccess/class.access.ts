import { mst_user } from "@prisma/client";
import db from "../../prisma/client.prisma";
import { ForbiddenError } from "../HttpErrors/HttptErrors";

export const isClassAssistant = async (userId: string, classId: string) =>
  Boolean(
    await db.trn_class_collaborator.findFirst({
      where: { userId, classId, deletedAt: null },
      select: { id: true },
    })
  );

export const canManageClass = async (
  user: mst_user | undefined,
  classId: string
) =>
  user?.role === "LABORAN" ||
  (Boolean(user) && (await isClassAssistant(user!.id, classId)));

export const assertCanManageClass = async (
  user: mst_user | undefined,
  classId: string
) => {
  if (!(await canManageClass(user, classId)))
    throw new ForbiddenError(
      "Hanya laboran atau asisten kelas ini yang dapat melakukannya!"
    );
};

export const isLecturer = (user: mst_user | undefined) =>
  user?.role === "DOSEN";

export const lecturerSubjectScope = (user: mst_user | undefined) =>
  isLecturer(user) ? { lecturer_id: user!.id } : {};

export const assertLecturerOfSubject = (
  user: mst_user | undefined,
  lecturerId: string
) => {
  if (isLecturer(user) && user!.id !== lecturerId)
    throw new ForbiddenError("Mata kuliah ini bukan yang Anda ampu.");
};

export const assertLecturerOfClass = async (
  user: mst_user | undefined,
  classId: string
) => {
  if (!isLecturer(user)) return;

  const classData = await db.mst_class.findUnique({
    where: { id: classId },
    select: { subject: { select: { lecturer_id: true } } },
  });

  if (classData && classData.subject.lecturer_id !== user!.id)
    throw new ForbiddenError("Kelas ini bukan mata kuliah yang Anda ampu.");
};
