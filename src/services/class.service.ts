import { ClassRoom, DaysOfWeek } from "@prisma/client";
import {
  IAddClassRequestBody,
  IClassRegistrationRequestBody,
  IGetAllClassByPaidActivationsResponseBody,
  IGetClassByIdResponseBody,
  IGetClassResponseBody,
} from "../interfaces/class.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { Request } from "express";

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

    await db.mst_class.create({
      data: {
        ...body,
        day: day as DaysOfWeek,
        room: room as ClassRoom,
        created_by: req.user?.id!,
      },
    });

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

    const subjectIds = studentActivation.map((data) => data.subjectId);

    const availableClass = await db.mst_class.findMany({
      where: {
        subjectId: {
          in: subjectIds,
        },
        deleted_at: null,
      },
      include: {
        subject: true,
        participants: true,
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
  try {
    const user = req.user;
    const { classIds } = body;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("User not allowed!");

    const registeredClass = await db.trn_class_participants.findMany({
      where: {
        userId: user?.id,
        classId: {
          in: classIds,
        },
      },
    });

    if (registeredClass.length > 0) {
      const alreadyRegisteredClassIds = registeredClass.map((a) => a.classId);
      throw new ConflictError(
        `Already activated current class(es) : ${alreadyRegisteredClassIds.join(
          ", "
        )}`
      );
    }

    await db.trn_class_participants.createMany({
      data: classIds.map((classId) => ({
        userId: user?.id!,
        classId,
      })),
      skipDuplicates: true,
    });

    return {
      status: true,
      message: "Registered to selected class",
    };
  } catch (error) {
    throw error;
  }
};
