import { ClassRoom, DaysOfWeek, Prisma } from "@prisma/client";
import {
  IAddClassRequestBody,
  IClassRegistrationRequestBody,
  IDeleteClassResponseBody,
  IGetAllClassByPaidActivationsResponseBody,
  IGetClassByIdResponseBody,
  IGetClassResponseBody,
  IGetClassmateResponseBody,
  IGetMyClassResponseBody,
  IUpdateClassRequestBody,
} from "../interfaces/class.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  UnauthorizedError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { Request } from "express";
import {
  publishClassMembersEvent,
  publishRealtimeEvent,
} from "../utils/RealtimeEvents/realtime.events";
import {
  assertNoAssistantScheduleClash,
  assertNoMemberScheduleClash,
} from "../utils/AssistantRules/assistant.rules";
import { assertLecturerOfClass } from "../utils/ClassAccess/class.access";
import {
  DAY_LABELS,
  dayGroupOf,
  formatSchedule,
  isScheduleClash,
} from "../utils/Schedule/schedule";

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const readQuota = (value: unknown) => {
  const quota =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;

  if (!Number.isInteger(quota) || (quota as number) < 1 || (quota as number) > 99)
    throw new BadRequestError("Kuota harus angka 1 sampai 99!");

  return quota as number;
};

interface IClassFields {
  name: string;
  quota: number;
  day: DaysOfWeek;
  room: ClassRoom;
  sessionId: string;
}

const readClassFields = (body: IAddClassRequestBody): IClassFields => {
  const name = readText(body?.name).toUpperCase();
  const day = readText(body?.day);
  const room = readText(body?.room);
  const sessionId = readText(body?.sessionId);

  if (!/^[A-Z]$/.test(name))
    throw new BadRequestError("Nama kelas harus satu huruf A–Z!");

  const quota = readQuota(body?.quota);

  if (!Object.values(DaysOfWeek).includes(day as DaysOfWeek))
    throw new BadRequestError("Hari harus Senin sampai Jumat!");

  if (!Object.values(ClassRoom).includes(room as ClassRoom))
    throw new BadRequestError("Ruangan harus PSI atau SBTI!");

  if (!sessionId) throw new BadRequestError("Sesi kelas wajib dipilih!");

  return {
    name,
    quota,
    day: day as DaysOfWeek,
    room: room as ClassRoom,
    sessionId,
  };
};

const findClassSession = async (
  fields: IClassFields,
  currentSessionId?: string | null
) => {
  const session = await db.mst_session.findUnique({
    where: { id: fields.sessionId },
  });

  if (!session || (!session.is_active && session.id !== currentSessionId))
    throw new BadRequestError("Sesi tidak ditemukan atau sudah nonaktif!");

  if (session.day_group !== dayGroupOf(fields.day))
    throw new BadRequestError(
      `Sesi ${session.number} bukan sesi hari ${DAY_LABELS[fields.day]}!`
    );

  return session;
};

const assertClassNameFree = async (
  subjectId: string,
  subjectName: string,
  name: string,
  exceptId?: string
) => {
  const duplicate = await db.mst_class.findFirst({
    where: {
      subjectId,
      name,
      deleted_at: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
  });

  if (duplicate)
    throw new ConflictError(`Kelas ${name} sudah ada di ${subjectName}!`);
};

const assertRoomFree = async (
  schedule: { day: DaysOfWeek; room: ClassRoom; startAt: string; endAt: string },
  exceptId?: string
) => {
  const sameRoom = await db.mst_class.findMany({
    where: {
      day: schedule.day,
      room: schedule.room,
      deleted_at: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
    include: { subject: { select: { subject_name: true } } },
  });
  const clash = sameRoom.find((item) => isScheduleClash(item, schedule));

  if (clash)
    throw new ConflictError(
      `Ruang ${schedule.room} sudah dipakai ${clash.subject.subject_name} kelas ${clash.name} (${formatSchedule(clash)}).`
    );
};

export const SAddClass = async (
  body: IAddClassRequestBody,
  req: Request
): Promise<IBaseResponse<{ id: string }>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat menambah kelas!");

  const subjectId = readText(body?.subjectId);

  if (!subjectId) throw new BadRequestError("Mata kuliah wajib dipilih!");

  const fields = readClassFields(body);

  const subject = await db.mst_subject.findFirst({
    where: { id: subjectId, deleted_at: null },
  });

  if (!subject) throw new NotFoundError("Mata kuliah tidak ditemukan!");

  const session = await findClassSession(fields);

  await assertClassNameFree(subjectId, subject.subject_name, fields.name);
  await assertRoomFree({
    day: fields.day,
    room: fields.room,
    startAt: session.startAt,
    endAt: session.endAt,
  });

  const newClass = await db.mst_class.create({
    data: {
      subjectId,
      ...fields,
      startAt: session.startAt,
      endAt: session.endAt,
      created_by: req.user.id,
    },
  });

  publishRealtimeEvent("class", { class_id: newClass.id, action: "created" });

  return {
    status: true,
    message: `Kelas ${subject.subject_name} ${fields.name} berhasil ditambahkan`,
    data: { id: newClass.id },
  };
};

export const SUpdateClass = async (
  id: string,
  body: IUpdateClassRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat mengubah kelas!");

  const current = await db.mst_class.findFirst({
    where: { id, deleted_at: null },
    include: {
      subject: { select: { subject_name: true } },
      participants: { where: { deleted_at: null }, select: { userId: true } },
    },
  });

  if (!current) throw new NotFoundError("Kelas tidak ditemukan!");

  if (body?.subjectId !== undefined && body.subjectId !== current.subjectId)
    throw new BadRequestError("Mata kuliah kelas tidak bisa diubah!");

  const fields = readClassFields({
    name: body?.name ?? current.name,
    quota: body?.quota ?? current.quota,
    day: body?.day ?? current.day,
    room: body?.room ?? current.room,
    sessionId: body?.sessionId ?? current.sessionId ?? undefined,
  });

  if (fields.quota < current.participants.length)
    throw new ConflictError(
      `Kuota tidak boleh kurang dari jumlah peserta (${current.participants.length})!`
    );

  const session = await findClassSession(fields, current.sessionId);
  const schedule = {
    day: fields.day,
    room: fields.room,
    startAt: session.startAt,
    endAt: session.endAt,
  };
  const isRenamed = fields.name !== current.name;
  const isRescheduled =
    schedule.day !== current.day ||
    schedule.startAt !== current.startAt ||
    schedule.endAt !== current.endAt;
  const isMoved = isRescheduled || schedule.room !== current.room;

  if (
    !isRenamed &&
    !isMoved &&
    fields.quota === current.quota &&
    fields.sessionId === current.sessionId
  )
    return { status: true, message: "Tidak ada perubahan pada kelas" };

  if (isRenamed)
    await assertClassNameFree(
      current.subjectId,
      current.subject.subject_name,
      fields.name,
      id
    );

  if (isMoved) await assertRoomFree(schedule, id);

  if (isRescheduled) await assertNoMemberScheduleClash(id, schedule);

  await db.mst_class.update({
    where: { id },
    data: {
      ...fields,
      startAt: session.startAt,
      endAt: session.endAt,
      updated_by: req.user.id,
      updated_at: new Date(),
    },
  });

  publishRealtimeEvent("class", { class_id: id, action: "updated" });
  void publishClassMembersEvent(id, "activation", { class_id: id });

  return {
    status: true,
    message: `Kelas ${current.subject.subject_name} ${fields.name} berhasil diperbarui`,
  };
};

export const SDeleteClass = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IDeleteClassResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat menghapus kelas!");

  const classData = await db.mst_class.findFirst({
    where: { id, deleted_at: null },
    include: {
      subject: { select: { subject_name: true } },
      participants: { where: { deleted_at: null }, select: { userId: true } },
      trn_class_collaborator: {
        where: { deletedAt: null },
        select: { userId: true },
      },
      trn_meetings: {
        select: { _count: { select: { participants: true } } },
      },
    },
  });

  if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

  const recordedMeetings = classData.trn_meetings.filter(
    (meeting) => meeting._count.participants > 0
  ).length;

  if (recordedMeetings > 0)
    throw new ConflictError(
      `Kelas ini sudah punya presensi di ${recordedMeetings} pertemuan, jadi tidak bisa dihapus. Ubah kelasnya bila ada data yang salah.`
    );

  try {
    await db.$transaction([
      db.trn_meetings.deleteMany({ where: { classId: id } }),
      db.trn_class_participants.deleteMany({ where: { classId: id } }),
      db.trn_class_collaborator.deleteMany({ where: { classId: id } }),
      db.mst_class.delete({ where: { id } }),
    ]);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      throw new ConflictError(
        "Presensi baru saja tercatat di kelas ini, jadi kelas tidak bisa dihapus."
      );

    throw error;
  }

  const memberIds = [
    ...classData.participants,
    ...classData.trn_class_collaborator,
  ].map((member) => member.userId);

  publishRealtimeEvent("class", { class_id: id, action: "deleted" });
  if (memberIds.length > 0)
    publishRealtimeEvent("activation", { class_id: id }, memberIds);

  return {
    status: true,
    message: `Kelas ${classData.subject.subject_name} ${classData.name} berhasil dihapus`,
    data: {
      participants: classData.participants.length,
      assistants: classData.trn_class_collaborator.length,
      meetings: classData.trn_meetings.length,
    },
  };
};

export const SGetAllClasses = async (
  req: Request
): Promise<IBaseResponse<IGetClassResponseBody[]>> => {
  try {
    const user = req.user;

    const classesData = await db.mst_class.findMany({
      where: {
        deleted_at: null,
        ...(user?.role === "MAHASISWA" && {
          trn_class_collaborator: {
            some: { userId: user.id, deletedAt: null },
          },
        }),
        ...(user?.role === "DOSEN" && {
          subject: { lecturer_id: user.id },
        }),
      },
      include: {
        participants: {
          select: {
            userId: true,
          },
        },
        subject: {
          select: {
            subject_name: true,
            semester: true,
          },
        },
      },
    });

    const data: IGetClassResponseBody[] = classesData.map((classData) => ({
      id: classData.id,
      subjectId: classData.subjectId,
      name: classData.name,
      subject_name: classData.subject.subject_name,
      semester: classData.subject.semester,
      quota: classData.quota,
      isFull: classData.quota === classData.participants.length,
      room: classData.room,
      sessionId: classData.sessionId,
      day: classData.day,
      startAt: classData.startAt,
      endAt: classData.endAt,
      participants: classData.participants.length,
    }));

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SGetClassById = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IGetClassByIdResponseBody>> => {
  try {
    const classData = await db.mst_class.findUnique({
      where: {
        id,
        deleted_at: null,
      },
      include: {
        participants: {
          select: {
            userId: true,
          },
        },
        subject: {
          select: {
            semester: true,
            subject_name: true,
            lecturer: true,
          },
        },
        trn_meetings: {
          select: { _count: { select: { participants: true } } },
        },
      },
    });

    if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

    await assertLecturerOfClass(req.user, classData.id);

    const data: IGetClassByIdResponseBody = {
      id: classData.id,
      subjectId: classData.subjectId,
      name: classData.name,
      subject_name: classData.subject.subject_name,
      semester: classData.subject.semester,
      quota: classData.quota,
      isFull: classData.quota === classData.participants.length,
      room: classData.room,
      sessionId: classData.sessionId,
      day: classData.day,
      startAt: classData.startAt,
      endAt: classData.endAt,
      lecturer: classData.subject.lecturer.fullname,
      participants: classData.participants.length,
      meetings: classData.trn_meetings.length,
      recorded_meetings: classData.trn_meetings.filter(
        (meeting) => meeting._count.participants > 0
      ).length,
    };

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllClassByPaidActivations = async (
  req: Request
): Promise<IBaseResponse<IGetAllClassByPaidActivationsResponseBody[]>> => {
  try {
    const user = req.user;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("User not allowed!");

    const studentActivation = await db.trn_activations.findMany({
      where: {
        userId: user.id,
        status: true,
        deleted_at: null,
      },
    });

    const enrolledSubjectIds = await getEnrolledSubjectIds(user.id);

    const subjectIds = studentActivation
      .map((data) => data.subjectId)
      .filter((subjectId) => !enrolledSubjectIds.includes(subjectId));

    const availableClass = await db.mst_class.findMany({
      where: {
        subjectId: {
          in: subjectIds,
        },
        deleted_at: null,
      },
      include: {
        subject: true,
        participants: {
          where: { deleted_at: null },
        },
      },
    });

    const data: IGetAllClassByPaidActivationsResponseBody[] =
      availableClass.map((data) => ({
        id: data.id,
        subject_name: data.subject.subject_name,
        subject_class: data.name,
        semester: data.subject.semester,
        quota: data.quota,
        day: data.day,
        registered_students: data.participants.length,
        session_time: `${data.startAt} - ${data.endAt}`,
      }));

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SClassRegistration = async (
  body: IClassRegistrationRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  const user = req.user;
  const { classIds } = body;

  if (user?.role !== "MAHASISWA")
    throw new UnauthorizedError("Anda tidak memiliki akses!");

  if (
    !Array.isArray(classIds) ||
    classIds.length === 0 ||
    classIds.some((classId) => typeof classId !== "string")
  )
    throw new BadRequestError("Pilih minimal satu kelas!");

  const classes = await db.mst_class.findMany({
    where: {
      id: { in: classIds },
      deleted_at: null,
    },
    include: {
      subject: { select: { subject_name: true } },
      participants: {
        where: { deleted_at: null },
        select: { userId: true },
      },
    },
  });

  if (classes.length !== new Set(classIds).size)
    throw new NotFoundError("Kelas tidak ditemukan!");

  const subjectIds = classes.map((c) => c.subjectId);

  if (new Set(subjectIds).size !== subjectIds.length)
    throw new BadRequestError("Pilih satu kelas untuk setiap mata kuliah!");

  const paidActivations = await db.trn_activations.findMany({
    where: {
      userId: user.id,
      subjectId: { in: subjectIds },
      status: true,
      deleted_at: null,
    },
    select: { subjectId: true },
  });

  const unpaidClass = classes.find(
    (c) => !paidActivations.some((a) => a.subjectId === c.subjectId)
  );

  if (unpaidClass)
    throw new ForbiddenError(
      `Pembayaran praktikum ${unpaidClass.subject.subject_name} belum dikonfirmasi!`
    );

  const existingEnrollment = await db.trn_class_participants.findFirst({
    where: {
      userId: user.id,
      deleted_at: null,
      class: { subjectId: { in: subjectIds }, deleted_at: null },
    },
    include: {
      class: { include: { subject: { select: { subject_name: true } } } },
    },
  });

  if (existingEnrollment)
    throw new ConflictError(
      `Anda sudah terdaftar di kelas ${existingEnrollment.class.name} untuk ${existingEnrollment.class.subject.subject_name}!`
    );

  const fullClass = classes.find((c) => c.participants.length >= c.quota);

  if (fullClass)
    throw new ConflictError(
      `Kelas ${fullClass.name} ${fullClass.subject.subject_name} sudah penuh!`
    );

  await assertNoAssistantScheduleClash(user.id, classes, "Anda pegang");

  await db.trn_class_participants.createMany({
    data: classes.map((c) => ({ userId: user.id, classId: c.id })),
  });

  classes.forEach((c) => publishRealtimeEvent("class", { class_id: c.id }));
  publishRealtimeEvent("activation", {}, [user.id]);

  return {
    status: true,
    message: "Berhasil terdaftar di kelas yang dipilih",
  };
};

export const SGetMyClasses = async (
  req: Request
): Promise<IBaseResponse<IGetMyClassResponseBody[]>> => {
  const user = req.user;

  if (user?.role !== "MAHASISWA")
    throw new UnauthorizedError("Anda tidak memiliki akses!");

  const enrollments = await db.trn_class_participants.findMany({
    where: {
      userId: user.id,
      deleted_at: null,
      class: { deleted_at: null },
    },
    include: {
      class: {
        include: {
          subject: {
            include: { lecturer: { select: { fullname: true } } },
          },
        },
      },
    },
    orderBy: [{ class: { day: "asc" } }, { class: { startAt: "asc" } }],
  });

  const data: IGetMyClassResponseBody[] = enrollments.map(
    ({ class: classData }) => ({
      id: classData.id,
      subject_id: classData.subjectId,
      subject_name: classData.subject.subject_name,
      subject_class: classData.name,
      semester: classData.subject.semester,
      lecturer: classData.subject.lecturer.fullname,
      day: classData.day,
      session_time: `${classData.startAt} - ${classData.endAt}`,
      room: classData.room,
    })
  );

  return {
    status: true,
    message: "Berhasil",
    data,
  };
};

const getEnrolledSubjectIds = async (userId: string): Promise<string[]> => {
  const enrollments = await db.trn_class_participants.findMany({
    where: {
      userId,
      deleted_at: null,
      class: { deleted_at: null },
    },
    select: { class: { select: { subjectId: true } } },
  });

  return enrollments.map((e) => e.class.subjectId);
};

export const SGetClassmates = async (
  classId: string,
  req: Request
): Promise<IBaseResponse<IGetClassmateResponseBody[]>> => {
  const user = req.user;

  const classData = await db.mst_class.findFirst({
    where: { id: classId, deleted_at: null },
    select: { id: true },
  });

  if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

  await assertLecturerOfClass(user, classData.id);

  const participants = await db.trn_class_participants.findMany({
    where: { classId: classData.id, deleted_at: null },
    select: { userId: true, user: { select: { fullname: true } } },
    orderBy: { user: { fullname: "asc" } },
  });

  if (
    user?.role === "MAHASISWA" &&
    !participants.some((participant) => participant.userId === user.id)
  )
    throw new ForbiddenError("Anda tidak terdaftar di kelas ini!");

  return {
    status: true,
    message: "Berhasil",
    data: participants.map((participant) => ({
      name: participant.user.fullname,
      is_me: participant.userId === user?.id,
    })),
  };
};
