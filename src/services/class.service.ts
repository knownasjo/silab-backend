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
import {
  assertAssistantOfClass,
  assertLecturerOfClass,
} from "../utils/ClassAccess/class.access";
import { rethrowIfSubjectDeleted } from "../utils/SubjectRules/subject.rules";
import {
  assertNoParticipantScheduleClash,
  enrollInClasses,
  findEnrollmentInSubjects,
  findFullClass,
} from "../utils/EnrollmentRules/enrollment.rules";
import {
  DAY_LABELS,
  formatSchedule,
  isScheduleClash,
} from "../utils/Schedule/schedule";
import {
  assertPeriodActive,
  findActivePeriod,
  getActivePeriod,
  periodLabel,
  resolveViewPeriod,
} from "../utils/PeriodRules/period.rules";

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
  periodId: string,
  currentSessionId?: string | null
) => {
  const session = await db.mst_session.findUnique({
    where: { id: fields.sessionId },
  });

  if (
    !session ||
    session.periodId !== periodId ||
    (!session.isActive && session.id !== currentSessionId)
  )
    throw new BadRequestError("Sesi tidak ditemukan atau sudah nonaktif!");

  if (session.day !== fields.day || session.room !== fields.room)
    throw new BadRequestError(
      `Sesi ${session.number} bukan sesi hari ${DAY_LABELS[fields.day]} di ruang ${fields.room}!`
    );

  return session;
};

const lockPeriodClasses = (tx: Prisma.TransactionClient, periodId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`class:period:${periodId}`}))`;

const assertClassNameFree = async (
  tx: Prisma.TransactionClient,
  subjectId: string,
  subjectName: string,
  name: string,
  periodId: string,
  exceptId?: string
) => {
  const duplicate = await tx.mst_class.findFirst({
    where: {
      subjectId,
      name,
      periodId,
      deletedAt: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
  });

  if (duplicate)
    throw new ConflictError(`Kelas ${name} sudah ada di ${subjectName}!`);
};

const assertRoomFree = async (
  tx: Prisma.TransactionClient,
  schedule: { day: DaysOfWeek; room: ClassRoom; startAt: string; endAt: string },
  periodId: string,
  exceptId?: string
) => {
  const sameRoom = await tx.mst_class.findMany({
    where: {
      day: schedule.day,
      room: schedule.room,
      periodId,
      deletedAt: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
    include: { subject: { select: { subjectName: true } } },
  });
  const clash = sameRoom.find((item) => isScheduleClash(item, schedule));

  if (clash)
    throw new ConflictError(
      `Ruang ${schedule.room} sudah dipakai ${clash.subject.subjectName} kelas ${clash.name} (${formatSchedule(clash)}).`
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
    where: { id: subjectId, deletedAt: null },
  });

  if (!subject) throw new NotFoundError("Mata kuliah tidak ditemukan!");

  const period = await getActivePeriod();
  const session = await findClassSession(fields, period.id);

  const newClass = await db
    .$transaction(
      async (tx) => {
        await lockPeriodClasses(tx, period.id);
        await assertClassNameFree(
          tx,
          subjectId,
          subject.subjectName,
          fields.name,
          period.id
        );
        await assertRoomFree(
          tx,
          {
            day: fields.day,
            room: fields.room,
            startAt: session.startAt,
            endAt: session.endAt,
          },
          period.id
        );

        return tx.mst_class.create({
          data: {
            subjectId,
            periodId: period.id,
            ...fields,
            startAt: session.startAt,
            endAt: session.endAt,
            createdBy: req.user!.id,
          },
        });
      },
      { maxWait: 10000, timeout: 20000 }
    )
    .catch(rethrowIfSubjectDeleted);

  publishRealtimeEvent("class", { classId: newClass.id, action: "created" });

  return {
    status: true,
    message: `Kelas ${subject.subjectName} ${fields.name} berhasil ditambahkan`,
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
    where: { id, deletedAt: null },
    include: {
      subject: { select: { subjectName: true } },
    },
  });

  if (!current) throw new NotFoundError("Kelas tidak ditemukan!");

  await assertPeriodActive(current.periodId);

  if (body?.subjectId !== undefined && body.subjectId !== current.subjectId)
    throw new BadRequestError("Mata kuliah kelas tidak bisa diubah!");

  const fields = readClassFields({
    name: body?.name ?? current.name,
    quota: body?.quota ?? current.quota,
    day: body?.day ?? current.day,
    room: body?.room ?? current.room,
    sessionId: body?.sessionId ?? current.sessionId ?? undefined,
  });

  const session = await findClassSession(
    fields,
    current.periodId,
    current.sessionId
  );
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

  await enrollInClasses([], [id], async (tx) => {
    await lockPeriodClasses(tx, current.periodId);

    if (isRenamed)
      await assertClassNameFree(
        tx,
        current.subjectId,
        current.subject.subjectName,
        fields.name,
        current.periodId,
        id
      );

    if (isMoved) await assertRoomFree(tx, schedule, current.periodId, id);

    if (isRescheduled)
      await assertNoMemberScheduleClash(id, schedule, current.periodId, tx);

    const participants = await tx.trn_class_participants.count({
      where: { classId: id, deletedAt: null },
    });

    if (fields.quota < participants)
      throw new ConflictError(
        `Kuota tidak boleh kurang dari jumlah peserta (${participants})!`
      );

    await tx.mst_class.update({
      where: { id },
      data: {
        ...fields,
        startAt: session.startAt,
        endAt: session.endAt,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      },
    });
  });

  publishRealtimeEvent("class", { classId: id, action: "updated" });
  void publishClassMembersEvent(id, "activation", { classId: id });

  return {
    status: true,
    message: `Kelas ${current.subject.subjectName} ${fields.name} berhasil diperbarui`,
  };
};

export const SDeleteClass = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IDeleteClassResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat menghapus kelas!");

  const classData = await db.mst_class.findFirst({
    where: { id, deletedAt: null },
    include: {
      subject: { select: { subjectName: true } },
      participants: { where: { deletedAt: null }, select: { userId: true } },
      collaborators: {
        where: { deletedAt: null },
        select: { userId: true },
      },
      meetings: {
        select: { _count: { select: { participants: true } } },
      },
    },
  });

  if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

  await assertPeriodActive(classData.periodId);

  const recordedMeetings = classData.meetings.filter(
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
    ...classData.collaborators,
  ].map((member) => member.userId);

  publishRealtimeEvent("class", { classId: id, action: "deleted" });
  if (memberIds.length > 0)
    publishRealtimeEvent("activation", { classId: id }, memberIds);

  return {
    status: true,
    message: `Kelas ${classData.subject.subjectName} ${classData.name} berhasil dihapus`,
    data: {
      participants: classData.participants.length,
      assistants: classData.collaborators.length,
      meetings: classData.meetings.length,
    },
  };
};

export const SGetAllClasses = async (
  req: Request
): Promise<IBaseResponse<IGetClassResponseBody[]>> => {
  try {
    const user = req.user;
    const period = await resolveViewPeriod(req);

    if (!period) return { status: true, message: "Berhasil", data: [] };

    const classesData = await db.mst_class.findMany({
      where: {
        deletedAt: null,
        periodId: period.id,
        ...(user?.role === "MAHASISWA" && {
          collaborators: {
            some: { userId: user.id, deletedAt: null },
          },
        }),
        ...(user?.role === "DOSEN" && {
          subject: { lecturerId: user.id },
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
            subjectName: true,
            semester: true,
          },
        },
      },
    });

    const data: IGetClassResponseBody[] = classesData.map((classData) => ({
      id: classData.id,
      subjectId: classData.subjectId,
      name: classData.name,
      subjectName: classData.subject.subjectName,
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
      message: "Berhasil",
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
        deletedAt: null,
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
            subjectCode: true,
            subjectName: true,
            lecturer: true,
          },
        },
        meetings: {
          select: { _count: { select: { participants: true } } },
        },
        period: true,
      },
    });

    if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

    await assertLecturerOfClass(req.user, classData.id);
    await assertAssistantOfClass(req.user, classData.id);

    const activePeriod = await findActivePeriod();

    const data: IGetClassByIdResponseBody = {
      id: classData.id,
      subjectId: classData.subjectId,
      name: classData.name,
      subjectCode: classData.subject.subjectCode,
      subjectName: classData.subject.subjectName,
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
      meetings: classData.meetings.length,
      recordedMeetings: classData.meetings.filter(
        (meeting) => meeting._count.participants > 0
      ).length,
      period: classData.period && {
        id: classData.period.id,
        name: periodLabel(classData.period),
        isActive: classData.period.id === activePeriod?.id,
      },
    };

    return {
      status: true,
      message: "Berhasil",
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
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const period = await findActivePeriod();

    if (!period) return { status: true, message: "Berhasil", data: [] };

    const studentActivation = await db.trn_activations.findMany({
      where: {
        userId: user.id,
        periodId: period.id,
        status: true,
        deletedAt: null,
      },
    });

    const enrolledSubjectIds = await getEnrolledSubjectIds(user.id, period.id);

    const subjectIds = studentActivation
      .map((data) => data.subjectId)
      .filter((subjectId) => !enrolledSubjectIds.includes(subjectId));

    const availableClass = await db.mst_class.findMany({
      where: {
        subjectId: {
          in: subjectIds,
        },
        periodId: period.id,
        deletedAt: null,
      },
      include: {
        subject: true,
        participants: {
          where: { deletedAt: null },
        },
      },
      orderBy: [{ subject: { subjectName: "asc" } }, { name: "asc" }],
    });

    const data: IGetAllClassByPaidActivationsResponseBody[] =
      availableClass.map((data) => ({
        id: data.id,
        subjectName: data.subject.subjectName,
        subjectClass: data.name,
        semester: data.subject.semester,
        quota: data.quota,
        day: data.day,
        registeredStudents: data.participants.length,
        sessionTime: `${data.startAt} - ${data.endAt}`,
      }));

    return {
      status: true,
      message: "Berhasil",
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

  const period = await getActivePeriod();

  const classes = await enrollInClasses([user.id], classIds, async (tx) => {
    const classes = await tx.mst_class.findMany({
      where: {
        id: { in: classIds },
        periodId: period.id,
        deletedAt: null,
      },
      include: {
        subject: { select: { subjectName: true } },
      },
    });

    if (classes.length !== new Set(classIds).size)
      throw new NotFoundError("Kelas tidak ditemukan!");

    const subjectIds = classes.map((c) => c.subjectId);

    if (new Set(subjectIds).size !== subjectIds.length)
      throw new BadRequestError("Pilih satu kelas untuk setiap mata kuliah!");

    const paidActivations = await tx.trn_activations.findMany({
      where: {
        userId: user.id,
        subjectId: { in: subjectIds },
        periodId: period.id,
        status: true,
        deletedAt: null,
      },
      select: { subjectId: true },
    });

    const unpaidClass = classes.find(
      (c) => !paidActivations.some((a) => a.subjectId === c.subjectId)
    );

    if (unpaidClass)
      throw new ForbiddenError(
        `Pembayaran praktikum ${unpaidClass.subject.subjectName} belum dikonfirmasi!`
      );

    const existingEnrollment = await findEnrollmentInSubjects(
      tx,
      user.id,
      subjectIds,
      period.id
    );

    if (existingEnrollment)
      throw new ConflictError(
        `Anda sudah terdaftar di kelas ${existingEnrollment.class.name} untuk ${existingEnrollment.class.subject.subjectName}!`
      );

    const fullClass = await findFullClass(tx, classes);

    if (fullClass)
      throw new ConflictError(
        `Kelas ${fullClass.name} ${fullClass.subject.subjectName} sudah penuh!`
      );

    await assertNoAssistantScheduleClash(user.id, classes, "Anda pegang", tx);
    await assertNoParticipantScheduleClash(tx, user.id, classes, "Anda ikuti");

    await tx.trn_class_participants.createMany({
      data: classes.map((c) => ({ userId: user.id, classId: c.id })),
    });

    return classes;
  });

  classes.forEach((c) => publishRealtimeEvent("class", { classId: c.id }));
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

  const period = await findActivePeriod();

  if (!period) return { status: true, message: "Berhasil", data: [] };

  const enrollments = await db.trn_class_participants.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      class: { deletedAt: null, periodId: period.id },
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
      subjectId: classData.subjectId,
      subjectName: classData.subject.subjectName,
      subjectClass: classData.name,
      semester: classData.subject.semester,
      lecturer: classData.subject.lecturer.fullname,
      day: classData.day,
      sessionTime: `${classData.startAt} - ${classData.endAt}`,
      room: classData.room,
    })
  );

  return {
    status: true,
    message: "Berhasil",
    data,
  };
};

const getEnrolledSubjectIds = async (
  userId: string,
  periodId: string
): Promise<string[]> => {
  const enrollments = await db.trn_class_participants.findMany({
    where: {
      userId,
      deletedAt: null,
      class: { deletedAt: null, periodId },
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
    where: { id: classId, deletedAt: null },
    select: { id: true },
  });

  if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

  await assertLecturerOfClass(user, classData.id);

  const participants = await db.trn_class_participants.findMany({
    where: { classId: classData.id, deletedAt: null },
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
      isMe: participant.userId === user?.id,
    })),
  };
};
