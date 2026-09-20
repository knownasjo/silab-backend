import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import {
  IAddActivationRequestBody,
  IAvailableClass,
  IGetActivationResponseBody,
  IUpdateActivationRequestBody,
} from "../interfaces/activation.interface";
import { Prisma } from "@prisma/client";

export const SAddStudentActivation = async (
  body: IAddActivationRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const { subjectIds } = body;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("User is not allowed!");

    const existingActivations = await db.trn_activations.findMany({
      where: {
        userId: user.id,
        subjectId: {
          in: subjectIds,
        },
      },
    });

    if (existingActivations.length > 0) {
      const alreadyActivatedIds = existingActivations.map((a) => a.subjectId);
      throw new ConflictError(
        `Already activated current subjects : ${alreadyActivatedIds.join(", ")}`
      );
    }

    await db.trn_activations.createMany({
      data: subjectIds.map((subjectId) => ({
        userId: user.id,
        subjectId,
      })),
      skipDuplicates: true,
    });

    return {
      status: true,
      message: "Activation added",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllActivations = async (
  req: Request
): Promise<IBaseResponse<IGetActivationResponseBody[]>> => {
  try {
    const user = req.user;
    const statusQuery = req.query.status;
    const nameQuery = req.query.name?.toString();

    const whereCondition = {
      deleted_at: null,
      ...(user?.role === "MAHASISWA" && {
        userId: user.id,
      }),
      ...(statusQuery ? { status: statusQuery === "true" } : {}),
      ...(nameQuery && {
        user: {
          fullname: {
            contains: nameQuery,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      }),
    };

    const activationsData = await db.trn_activations.findMany({
      where: whereCondition,
      include: {
        user: {
          select: {
            id: true,
            nim: true,
            fullname: true,
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

    const subjectIds = [...new Set(activationsData.map((a) => a.subjectId))];

    const classesData = await db.mst_class.findMany({
      where: {
        subjectId: { in: subjectIds },
        deleted_at: null,
      },
      include: {
        participants: {
          where: { deleted_at: null },
          select: { userId: true },
        },
      },
    });

    const data: IGetActivationResponseBody[] = activationsData.map(
      (activation) => {
        const classesOfSubject = classesData.filter(
          (c) => c.subjectId === activation.subjectId
        );

        const enrolledClass = classesOfSubject.find((c) =>
          c.participants.some((p) => p.userId === activation.userId)
        );

        const availableClasses: IAvailableClass[] = classesOfSubject.map(
          (c) => ({
            id: c.id,
            name: c.name,
            day: c.day,
            session_time: `${c.startAt} - ${c.endAt}`,
            room: c.room,
            quota: c.quota,
            registered_students: c.participants.length,
            is_full: c.participants.length >= c.quota,
          })
        );

        return {
          id: activation.id,
          user_id: activation.userId,
          nim: activation.user.nim,
          student: activation.user.fullname,
          status: activation.status,
          subject_id: activation.subjectId,
          subjects: [activation.subject],
          registered_class: enrolledClass
            ? { id: enrolledClass.id, name: enrolledClass.name }
            : null,
          available_classes: availableClasses,
        };
      }
    );

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Menandai pembayaran lunas.
 *
 * Bila body menyertakan classId, mahasiswa sekaligus didaftarkan ke kelas
 * tersebut. Bila tidak, perilakunya sama seperti sebelumnya — hanya mengubah
 * status pembayaran, dan mahasiswa memilih kelasnya sendiri lewat
 * POST /class/registration (jalur aplikasi mobile).
 */
export const SUpdateActivationPaymentStatus = async (
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const id = req.params.id.toString();
    const { classId } = req.body as IUpdateActivationRequestBody;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed!");

    const isActivationExist = await db.trn_activations.findUnique({
      where: {
        id,
      },
    });

    if (!isActivationExist) throw new NotFoundError("Activation not found!");

    if (!classId) {
      await db.trn_activations.update({
        where: { id },
        data: {
          status: true,
          updated_at: new Date(),
        },
      });

      return {
        status: true,
        message: "Payment status updated",
      };
    }

    const classData = await db.mst_class.findFirst({
      where: {
        id: classId,
        deleted_at: null,
      },
      include: {
        participants: {
          where: { deleted_at: null },
          select: { userId: true },
        },
      },
    });

    if (!classData) throw new NotFoundError("Class not found!");

    if (classData.subjectId !== isActivationExist.subjectId)
      throw new ConflictError(
        "Class does not belong to the activated subject!"
      );

    const isAlreadyEnrolled = classData.participants.some(
      (p) => p.userId === isActivationExist.userId
    );

    if (isAlreadyEnrolled)
      throw new ConflictError("Student is already registered in this class!");

    if (classData.participants.length >= classData.quota)
      throw new ConflictError("Class quota is full!");

    await db.$transaction([
      db.trn_activations.update({
        where: { id },
        data: {
          status: true,
          updated_at: new Date(),
        },
      }),
      db.trn_class_participants.create({
        data: {
          classId: classId,
          userId: isActivationExist.userId,
        },
      }),
    ]);

    return {
      status: true,
      message: `Payment confirmed and student registered to class ${classData.name}`,
    };
  } catch (error) {
    throw error;
  }
};
