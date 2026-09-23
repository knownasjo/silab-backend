import { ClassRoom, DaysOfWeek } from "@prisma/client";
import {
  IAddClassRequestBody,
  IClassRegistrationRequestBody,
  IGetAllClassByPaidActivationsResponseBody,
  IGetClassByIdResponseBody,
  IGetClassResponseBody,
  IGetClassmateResponseBody,
  IGetMyClassResponseBody,
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
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";

export const SAddClass = async (
  body: IAddClassRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const { name, room, day, subjectId } = body;

    if (req.user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed to add subject");

    const isClassExist = await db.mst_class.findFirst({
      where: {
        name: name,
        subjectId: subjectId,
      },
    });

    if (isClassExist) throw new ConflictError("Class on subject already exist");

    const newClass = await db.mst_class.create({
      data: {
        ...body,
        day: day as DaysOfWeek,
        room: room as ClassRoom,
        created_by: req.user?.id!,
      },
    });

    publishRealtimeEvent("class", { class_id: newClass.id, action: "created" });

    return {
      status: true,
      message: "Class added",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllClasses = async (): Promise<
  IBaseResponse<IGetClassResponseBody[]>
> => {
  try {
    const classesData = await db.mst_class.findMany({
      where: {
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
  id: string
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
      },
    });

    if (!classData) throw new NotFoundError("Class not found!");

    const data: IGetClassByIdResponseBody = {
      id: classData.id,
      subjectId: classData.subjectId,
      name: classData.name,
      subject_name: classData.subject.subject_name,
      semester: classData.subject.semester,
      quota: classData.quota,
      isFull: classData.quota === classData.participants.length,
      room: classData.room,
      day: classData.day,
      startAt: classData.startAt,
      endAt: classData.endAt,
      lecturer: classData.subject.lecturer.fullname,
      participants: classData.participants.length,
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
