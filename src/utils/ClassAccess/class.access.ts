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
