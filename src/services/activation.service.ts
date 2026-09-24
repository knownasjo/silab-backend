import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
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
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  assertNoAssistantScheduleClash,
  assertNotAssistantOfSubjects,
} from "../utils/AssistantRules/assistant.rules";

export const SAddStudentActivation = async (
  body: IAddActivationRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const { subjectIds } = body;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

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
        `Mata kuliah berikut sudah pernah didaftarkan: ${alreadyActivatedIds.join(", ")}`
      );
    }

    await assertNotAssistantOfSubjects(user.id, subjectIds);

    await db.trn_activations.createMany({
      data: subjectIds.map((subjectId) => ({
        userId: user.id,
        subjectId,
      })),
      skipDuplicates: true,
    });

    publishRealtimeEvent("activation", {}, [user.id]);

    return {
      status: true,
      message: "Pendaftaran mata kuliah berhasil",
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
      orderBy: { createdAt: "desc" },
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
          created_at: activation.createdAt.toISOString(),
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
      message: "Berhasil",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateActivationPaymentStatus = async (
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const id = req.params.id.toString();
    const { classId, status } = req.body as IUpdateActivationRequestBody;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const newStatus = typeof status === "boolean" ? status : true;

    const isActivationExist = await db.trn_activations.findUnique({
      where: {
        id,
      },
    });

    if (!isActivationExist) throw new NotFoundError("Data aktivasi tidak ditemukan!");

    if (!newStatus) {
      if (classId)
        throw new BadRequestError(
          "Tidak bisa mendaftarkan kelas saat status diubah menjadi belum bayar!"
        );

      await db.trn_activations.update({
        where: { id },
        data: {
          status: false,
          updated_at: new Date(),
        },
      });

      publishRealtimeEvent("activation", {}, [isActivationExist.userId]);

      return {
        status: true,
        message: "Status pembayaran diubah menjadi belum bayar",
      };
    }

    if (!classId) {
      await db.trn_activations.update({
        where: { id },
        data: {
          status: true,
          updated_at: new Date(),
        },
      });

      publishRealtimeEvent("activation", {}, [isActivationExist.userId]);

      return {
        status: true,
        message: "Status pembayaran berhasil diperbarui",
      };
    }

    const classData = await db.mst_class.findFirst({
      where: {
        id: classId,
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

    if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

    if (classData.subjectId !== isActivationExist.subjectId)
      throw new ConflictError(
        "Kelas tidak termasuk dalam mata kuliah yang didaftarkan!"
      );

    const isAlreadyEnrolled = classData.participants.some(
      (p) => p.userId === isActivationExist.userId
    );

    if (isAlreadyEnrolled)
      throw new ConflictError("Mahasiswa sudah terdaftar di kelas ini!");

    if (classData.participants.length >= classData.quota)
      throw new ConflictError("Kuota kelas sudah penuh!");

    await assertNoAssistantScheduleClash(
      isActivationExist.userId,
      [classData],
      "dipegang mahasiswa ini"
    );

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

    publishRealtimeEvent("class", { class_id: classId });
    publishRealtimeEvent("activation", {}, [isActivationExist.userId]);

    return {
      status: true,
      message: `Pembayaran dikonfirmasi dan mahasiswa didaftarkan ke kelas ${classData.name}`,
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateStudentClass = async (
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const id = req.params.id.toString();
    const { classId } = req.body as IUpdateActivationRequestBody;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    if (!classId) throw new BadRequestError("Kelas tujuan wajib dipilih!");

    const activation = await db.trn_activations.findUnique({
      where: { id },
    });

    if (!activation) throw new NotFoundError("Data aktivasi tidak ditemukan!");

    if (!activation.status)
      throw new ConflictError(
        "Tidak bisa memindahkan kelas sebelum pembayaran dikonfirmasi!"
      );

    const targetClass = await db.mst_class.findFirst({
      where: {
        id: classId,
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

    if (!targetClass) throw new NotFoundError("Kelas tujuan tidak ditemukan!");

    if (targetClass.subjectId !== activation.subjectId)
      throw new ConflictError(
        "Kelas tujuan tidak termasuk dalam mata kuliah yang didaftarkan!"
      );

    const currentEnrollment = await db.trn_class_participants.findFirst({
      where: {
        userId: activation.userId,
        deleted_at: null,
        class: {
          subjectId: activation.subjectId,
        },
      },
      include: {
        class: {
          select: { id: true, name: true },
        },
      },
    });

    if (!currentEnrollment)
      throw new NotFoundError("Mahasiswa belum terdaftar di kelas mana pun!");

    if (currentEnrollment.classId === classId)
      throw new ConflictError("Mahasiswa sudah berada di kelas ini!");

    if (targetClass.participants.length >= targetClass.quota)
      throw new ConflictError("Kuota kelas tujuan sudah penuh!");

    await assertNoAssistantScheduleClash(
      activation.userId,
      [targetClass],
      "dipegang mahasiswa ini"
    );

    const existingAttendances = await db.trn_meeting_participants.findMany({
      where: {
        userId: activation.userId,
        meeting: {
          classId: currentEnrollment.classId,
        },
      },
    });

    if (existingAttendances.length > 0)
      throw new ConflictError(
        `Mahasiswa sudah memiliki ${existingAttendances.length} catatan presensi di kelas ${currentEnrollment.class.name}. Hapus catatan presensinya terlebih dahulu sebelum memindahkan kelas.`
      );

    await db.$transaction([
      db.trn_class_participants.delete({
        where: {
          classId_userId: {
            classId: currentEnrollment.classId,
            userId: activation.userId,
          },
        },
      }),
      db.trn_class_participants.create({
        data: {
          classId: classId,
          userId: activation.userId,
        },
      }),
    ]);

    publishRealtimeEvent("class", { class_id: currentEnrollment.classId });
    publishRealtimeEvent("class", { class_id: classId });
    publishRealtimeEvent("activation", {}, [activation.userId]);

    return {
      status: true,
      message: `Mahasiswa dipindahkan dari kelas ${currentEnrollment.class.name} ke kelas ${targetClass.name}`,
    };
  } catch (error) {
    throw error;
  }
};
