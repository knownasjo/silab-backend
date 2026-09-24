import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddCollaboratorRequestBody,
  IGetCollaboratorsResponseBody,
} from "../interfaces/collaborator.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import { formatSchedule, isScheduleClash } from "../utils/Schedule/schedule";

const classSchedule = {
  select: {
    name: true,
    day: true,
    startAt: true,
    endAt: true,
    subject: { select: { subject_name: true } },
  },
};

const assertLaboran = (req: Request) => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat mengatur asisten kelas!");
};

export const SAddCollaborator = async (req: Request): Promise<IBaseResponse> => {
  assertLaboran(req);

  const body: Partial<IAddCollaboratorRequestBody> = req.body ?? {};
  const classId = typeof body.classId === "string" ? body.classId : "";
  const userIds = Array.isArray(body.collaborators)
    ? [
        ...new Set(
          body.collaborators.filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        ),
      ]
    : [];

  if (!classId || userIds.length === 0)
    throw new BadRequestError("Pilih kelas dan minimal satu mahasiswa!");

  const targetClass = await db.mst_class.findFirst({
    where: { id: classId, deleted_at: null },
    include: { subject: { select: { subject_name: true } } },
  });

  if (!targetClass) throw new NotFoundError("Kelas tidak ditemukan!");

  const users = await db.mst_user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fullname: true, role: true },
  });

  if (users.length !== userIds.length)
    throw new NotFoundError("Mahasiswa tidak ditemukan!");

  const notStudent = users.find((user) => user.role !== "MAHASISWA");

  if (notStudent)
    throw new BadRequestError(
      `${notStudent.fullname} bukan akun mahasiswa. Asisten harus mahasiswa.`
    );

  const current = await db.trn_class_collaborator.findMany({
    where: { classId, userId: { in: userIds }, deletedAt: null },
    select: { userId: true },
  });
  const newUsers = users.filter(
    (user) => !current.some((collaborator) => collaborator.userId === user.id)
  );

  if (newUsers.length === 0)
    throw new ConflictError("Mahasiswa sudah menjadi asisten kelas ini!");

  for (const user of newUsers) {
    const activation = await db.trn_activations.findFirst({
      where: {
        userId: user.id,
        subjectId: targetClass.subjectId,
        deleted_at: null,
      },
      select: { id: true },
    });

    if (activation)
      throw new ConflictError(
        `${user.fullname} sedang mengikuti praktikum ${targetClass.subject.subject_name}, jadi tidak bisa menjadi asisten mata kuliah ini.`
      );

    const [enrollments, assisting] = await Promise.all([
      db.trn_class_participants.findMany({
        where: {
          userId: user.id,
          deleted_at: null,
          class: { deleted_at: null },
        },
        select: { class: classSchedule },
      }),
      db.trn_class_collaborator.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          classId: { not: classId },
          class: { deleted_at: null },
        },
        select: { class: classSchedule },
      }),
    ]);

    const clash = [
      ...enrollments.map((row) => ({ ...row.class, role: "mengikuti praktikum" })),
      ...assisting.map((row) => ({ ...row.class, role: "menjadi asisten" })),
    ].find((schedule) => isScheduleClash(schedule, targetClass));

    if (clash)
      throw new ConflictError(
        `Jadwal bentrok: ${user.fullname} ${clash.role} ${clash.subject.subject_name} kelas ${clash.name} (${formatSchedule(clash)}).`
      );
  }

  const newUserIds = newUsers.map((user) => user.id);

  await db.$transaction([
    db.trn_class_collaborator.deleteMany({
      where: { classId, userId: { in: newUserIds }, deletedAt: { not: null } },
    }),
    db.trn_class_collaborator.createMany({
      data: newUserIds.map((userId) => ({ userId, classId })),
      skipDuplicates: true,
    }),
  ]);

  publishRealtimeEvent("class", { class_id: classId });

  return {
    status: true,
    message:
      newUsers.length === 1
        ? `${newUsers[0].fullname} ditambahkan sebagai asisten`
        : `${newUsers.length} mahasiswa ditambahkan sebagai asisten`,
  };
};

export const SRemoveCollaborator = async (
  req: Request
): Promise<IBaseResponse> => {
  assertLaboran(req);

  const classId = req.params.classId?.toString() ?? "";
  const userId = req.params.userId?.toString() ?? "";

  const { count } = await db.trn_class_collaborator.deleteMany({
    where: { classId, userId },
  });

  if (count === 0)
    throw new NotFoundError("Asisten tidak ditemukan di kelas ini!");

  publishRealtimeEvent("class", { class_id: classId });

  return {
    status: true,
    message: "Asisten dihapus dari kelas",
  };
};

export const SGetCollaborators = async (
  id: string
): Promise<IBaseResponse<IGetCollaboratorsResponseBody[]>> => {
  const collaboratorsData = await db.trn_class_collaborator.findMany({
    where: {
      classId: id,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: {
        select: {
          id: true,
          nim: true,
          fullname: true,
        },
      },
    },
  });

  const data: IGetCollaboratorsResponseBody[] = collaboratorsData.map(
    (collaborator) => ({
      id: collaborator.user.id,
      nim: collaborator.user.nim,
      fullname: collaborator.user.fullname,
    })
  );

  return {
    status: true,
    message: "Berhasil",
    data,
  };
};
