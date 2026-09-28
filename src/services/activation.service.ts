import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
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
import {
  assertNoParticipantScheduleClash,
  enrollInClasses,
  findEnrollmentInSubjects,
  findFullClass,
} from "../utils/EnrollmentRules/enrollment.rules";
import {
  assertPeriodActive,
  getActivePeriod,
  resolveViewPeriod,
} from "../utils/PeriodRules/period.rules";

export const SAddStudentActivation = async (
  body: IAddActivationRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const { subjectIds } = body;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    if (
      !Array.isArray(subjectIds) ||
      subjectIds.length === 0 ||
      subjectIds.some(
        (subjectId) => typeof subjectId !== "string" || !subjectId
      )
    )
      throw new BadRequestError("Pilih minimal satu mata kuliah!");

    const subjects = await db.mst_subject.findMany({
      where: { id: { in: subjectIds }, deleted_at: null },
      select: { id: true, subject_name: true },
    });

    if (subjects.length !== new Set(subjectIds).size)
      throw new NotFoundError("Mata kuliah tidak ditemukan!");

    const period = await getActivePeriod();

    const existingActivations = await db.trn_activations.findMany({
      where: {
        userId: user.id,
        periodId: period.id,
        subjectId: {
          in: subjectIds,
        },
      },
    });

    if (existingActivations.length > 0) {
      const alreadyActivatedNames = subjects
        .filter((s) => existingActivations.some((a) => a.subjectId === s.id))
        .map((s) => s.subject_name);
      throw new ConflictError(
        `Mata kuliah berikut sudah pernah didaftarkan: ${alreadyActivatedNames.join(", ")}`
      );
    }

    await assertNotAssistantOfSubjects(user.id, subjectIds, period.id);

    await db.trn_activations.createMany({
      data: subjectIds.map((subjectId) => ({
        userId: user.id,
        subjectId,
        periodId: period.id,
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

    if (user?.role === "DOSEN")
      throw new ForbiddenError(
        "Data pembayaran praktikum hanya bisa dilihat laboran!"
      );

    const period = await resolveViewPeriod(req);

    if (!period) return { status: true, message: "Berhasil", data: [] };

    const whereCondition = {
      deleted_at: null,
      periodId: period.id,
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
        periodId: period.id,
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

    if (typeof status !== "boolean")
      throw new BadRequestError(
        "Status pembayaran wajib diisi (true atau false)!"
      );

    if (classId != null && (typeof classId !== "string" || !classId))
      throw new BadRequestError("Kelas tidak valid!");

    const isActivationExist = await db.trn_activations.findUnique({
      where: {
        id,
      },
    });

    if (!isActivationExist) throw new NotFoundError("Data aktivasi tidak ditemukan!");

    await assertPeriodActive(isActivationExist.periodId);

    if (!status) {
      if (classId)
        throw new BadRequestError(
          "Tidak bisa mendaftarkan kelas saat status diubah menjadi belum bayar!"
        );

      const removedFrom = await enrollInClasses(
        [isActivationExist.userId],
        [],
        async (tx) => {
          const enrollment = await findEnrollmentInSubjects(
            tx,
            isActivationExist.userId,
            [isActivationExist.subjectId],
            isActivationExist.periodId
          );

          if (enrollment) {
            const recorded = await tx.trn_meeting_participants.count({
              where: {
                userId: isActivationExist.userId,
                meeting: { classId: enrollment.classId },
              },
            });

            if (recorded > 0)
              throw new ConflictError(
                `Mahasiswa sudah punya ${recorded} presensi di kelas ${enrollment.class.name}. Hapus presensinya dulu bila pembayaran memang harus dibatalkan.`
              );

            await tx.trn_class_participants.delete({
              where: {
                classId_userId: {
                  classId: enrollment.classId,
                  userId: isActivationExist.userId,
                },
              },
            });
          }

          await tx.trn_activations.update({
            where: { id },
            data: {
              status: false,
              updated_at: new Date(),
            },
          });

          return enrollment;
        }
      );

      if (removedFrom)
        publishRealtimeEvent("class", { class_id: removedFrom.classId });
      publishRealtimeEvent("activation", {}, [isActivationExist.userId]);

      return {
        status: true,
        message: removedFrom
          ? `Status pembayaran diubah menjadi belum bayar dan mahasiswa dikeluarkan dari kelas ${removedFrom.class.name}`
          : "Status pembayaran diubah menjadi belum bayar",
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

      const enrollment = await findEnrollmentInSubjects(
        db,
        isActivationExist.userId,
        [isActivationExist.subjectId],
        isActivationExist.periodId
      );

      return {
        status: true,
        message: enrollment
          ? "Status pembayaran berhasil diperbarui"
          : "Pembayaran dikonfirmasi. Mahasiswa memilih kelas sendiri di aplikasi.",
      };
    }

    const classData = await enrollInClasses(
      [isActivationExist.userId],
      [classId],
      async (tx) => {
        const classData = await tx.mst_class.findFirst({
          where: {
            id: classId,
            periodId: isActivationExist.periodId,
            deleted_at: null,
          },
          include: {
            subject: { select: { subject_name: true } },
          },
        });

        if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

        if (classData.subjectId !== isActivationExist.subjectId)
          throw new ConflictError(
            "Kelas tidak termasuk dalam mata kuliah yang didaftarkan!"
          );

        const enrollment = await findEnrollmentInSubjects(
          tx,
          isActivationExist.userId,
          [classData.subjectId],
          isActivationExist.periodId
        );

        if (enrollment)
          throw new ConflictError(
            enrollment.classId === classId
              ? "Mahasiswa sudah terdaftar di kelas ini!"
              : `Mahasiswa sudah terdaftar di kelas ${enrollment.class.name} untuk ${enrollment.class.subject.subject_name}!`
          );

        if (await findFullClass(tx, [classData]))
          throw new ConflictError("Kuota kelas sudah penuh!");

        await assertNoAssistantScheduleClash(
          isActivationExist.userId,
          [classData],
          "dipegang mahasiswa ini",
          tx
        );

        await assertNoParticipantScheduleClash(
          tx,
          isActivationExist.userId,
          [classData],
          "diikuti mahasiswa ini"
        );

        await tx.trn_activations.update({
          where: { id },
          data: {
            status: true,
            updated_at: new Date(),
          },
        });

        await tx.trn_class_participants.create({
          data: {
            classId: classId,
            userId: isActivationExist.userId,
          },
        });

        return classData;
      }
    );

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

    if (typeof classId !== "string" || !classId)
      throw new BadRequestError("Kelas tujuan wajib dipilih!");

    const activation = await db.trn_activations.findUnique({
      where: { id },
    });

    if (!activation) throw new NotFoundError("Data aktivasi tidak ditemukan!");

    await assertPeriodActive(activation.periodId);

    if (!activation.status)
      throw new ConflictError(
        "Tidak bisa memindahkan kelas sebelum pembayaran dikonfirmasi!"
      );

    const { currentEnrollment, targetClass } = await enrollInClasses(
      [activation.userId],
      [classId],
      async (tx) => {
        const targetClass = await tx.mst_class.findFirst({
          where: {
            id: classId,
            periodId: activation.periodId,
            deleted_at: null,
          },
          include: {
            subject: { select: { subject_name: true } },
          },
        });

        if (!targetClass)
          throw new NotFoundError("Kelas tujuan tidak ditemukan!");

        if (targetClass.subjectId !== activation.subjectId)
          throw new ConflictError(
            "Kelas tujuan tidak termasuk dalam mata kuliah yang didaftarkan!"
          );

        const currentEnrollment = await tx.trn_class_participants.findFirst({
          where: {
            userId: activation.userId,
            deleted_at: null,
            class: {
              subjectId: activation.subjectId,
              periodId: activation.periodId,
            },
          },
          include: {
            class: {
              select: { id: true, name: true },
            },
          },
        });

        if (!currentEnrollment)
          throw new NotFoundError(
            "Mahasiswa belum terdaftar di kelas mana pun!"
          );

        if (currentEnrollment.classId === classId)
          throw new ConflictError("Mahasiswa sudah berada di kelas ini!");

        if (await findFullClass(tx, [targetClass]))
          throw new ConflictError("Kuota kelas tujuan sudah penuh!");

        await assertNoAssistantScheduleClash(
          activation.userId,
          [targetClass],
          "dipegang mahasiswa ini",
          tx
        );

        await assertNoParticipantScheduleClash(
          tx,
          activation.userId,
          [targetClass],
          "diikuti mahasiswa ini",
          currentEnrollment.classId
        );

        const existingAttendances = await tx.trn_meeting_participants.count({
          where: {
            userId: activation.userId,
            meeting: {
              classId: currentEnrollment.classId,
            },
          },
        });

        if (existingAttendances > 0)
          throw new ConflictError(
            `Mahasiswa sudah memiliki ${existingAttendances} catatan presensi di kelas ${currentEnrollment.class.name}. Hapus catatan presensinya terlebih dahulu sebelum memindahkan kelas.`
          );

        await tx.trn_class_participants.delete({
          where: {
            classId_userId: {
              classId: currentEnrollment.classId,
              userId: activation.userId,
            },
          },
        });

        await tx.trn_class_participants.create({
          data: {
            classId: classId,
            userId: activation.userId,
          },
        });

        return { currentEnrollment, targetClass };
      }
    );

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
