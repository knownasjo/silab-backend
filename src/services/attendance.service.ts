import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddAttendanceRequestBody,
  ICheckAttendanceDeviceRequestBody,
  IAddAttendanceResponseBody,
  IUpdateAttendanceRequestBody,
  IUpdateAttendanceResponseBody,
} from "../interfaces/attendance.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { checkQrToken } from "../utils/QrToken/qr.token";
import { publishClassAssistantsEvent } from "../utils/RealtimeEvents/realtime.events";
import { assertCanManageClass } from "../utils/ClassAccess/class.access";
import {
  DEVICE_USED,
  isUsualDevice,
  loadDevices,
  makeUsualDevice,
  rememberDevice,
  requireDeviceId,
} from "../utils/DeviceRules/device.rules";
import { Prisma } from "@prisma/client";

const ALREADY_ATTENDED = "Anda sudah melakukan presensi untuk pertemuan ini!";
const ALREADY_CHECKED = "Presensi ini sudah dicek.";

export const SAddAttendance = async (
  classId: string,
  meetingId: string,
  body: IAddAttendanceRequestBody,
  req: Request
): Promise<IBaseResponse<IAddAttendanceResponseBody>> => {
  try {
    const receivedAt = Date.now();

    const user = req.user;
    const { token } = body;

    if (typeof token !== "string" || !token)
      throw new BadRequestError("Token presensi wajib diisi!");

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("Hanya mahasiswa yang dapat melakukan presensi!");

    const [meeting, isClassParticipant, devices] = await Promise.all([
      db.trn_meetings.findFirst({
        where: {
          id: meetingId,
          classId: classId,
          deleted_at: null,
        },
      }),
      db.trn_class_participants.findFirst({
        where: {
          classId: classId,
          userId: user.id,
          deleted_at: null,
        },
      }),
      loadDevices(user.id),
    ]);

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    if (!meeting.status)
      throw new ForbiddenError("Sesi presensi belum dibuka!");

    const tokenStatus = checkQrToken(meeting.id, token, receivedAt);

    if (tokenStatus === "EXPIRED")
      throw new BadRequestError(
        "QR sudah kedaluwarsa, silakan scan ulang QR di layar!"
      );

    if (tokenStatus === "INVALID")
      throw new BadRequestError("Token presensi tidak valid!");

    if (!isClassParticipant)
      throw new ForbiddenError("Anda tidak terdaftar di kelas ini!");

    const deviceId = requireDeviceId(body.device_id);

    const isKnownDevice = devices.some(
      (device) => device.device_id === deviceId
    );
    const isUsual = isUsualDevice(devices, deviceId);

    const attendance = await db.trn_meeting_participants
      .create({
        data: {
          meetingId: meetingId,
          userId: user.id,
          status: true,
          device_id: deviceId,
          device_check: isUsual ? "BIASA" : "TIDAK_BIASA",
        },
      })
      .catch(async (error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const ownAttendance = await db.trn_meeting_participants.findUnique({
            where: {
              meetingId_userId: { meetingId: meetingId, userId: user.id },
            },
          });

          throw new ConflictError(
            ownAttendance ? ALREADY_ATTENDED : DEVICE_USED
          );
        }

        throw error;
      });

    if (!isKnownDevice) await rememberDevice(user.id, deviceId);

    void publishClassAssistantsEvent(
      meeting.classId,
      "attendance",
      { class_id: meeting.classId, meeting_id: meeting.id },
      [user.id]
    );

    return {
      status: true,
      message: "Presensi berhasil dicatat",
      data: {
        meeting_id: meeting.id,
        meeting_name: meeting.name,
        student_name: user.fullname,
        nim: user.nim,
        submitted_at: attendance.createdAt,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateAttendanceManually = async (
  meetingId: string,
  userId: string,
  body: IUpdateAttendanceRequestBody,
  req: Request
): Promise<IBaseResponse<IUpdateAttendanceResponseBody>> => {
  try {
    const user = req.user;
    const { status } = body;

    if (typeof status !== "boolean")
      throw new BadRequestError("Status kehadiran harus berupa true atau false!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    await assertCanManageClass(user, meeting.classId);

    const student = await db.mst_user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!student) throw new NotFoundError("Mahasiswa tidak ditemukan!");

    const isClassParticipant = await db.trn_class_participants.findFirst({
      where: {
        classId: meeting.classId,
        userId: userId,
        deleted_at: null,
      },
    });

    if (!isClassParticipant)
      throw new ForbiddenError("Mahasiswa tidak terdaftar di kelas ini!");

    const attendance = await db.trn_meeting_participants.upsert({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
      update: {
        status: status,
      },
      create: {
        meetingId: meetingId,
        userId: userId,
        status: status,
      },
    });

    void publishClassAssistantsEvent(
      meeting.classId,
      "attendance",
      { class_id: meeting.classId, meeting_id: meeting.id },
      [student.id]
    );

    return {
      status: true,
      message: status
        ? "Mahasiswa ditandai hadir"
        : "Mahasiswa ditandai tidak hadir",
      data: {
        meeting_id: meeting.id,
        meeting_name: meeting.name,
        student_id: student.id,
        student_name: student.fullname,
        nim: student.nim,
        is_attended: attendance.status,
        submitted_at: attendance.createdAt,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SCheckAttendanceDevice = async (
  meetingId: string,
  userId: string,
  body: ICheckAttendanceDeviceRequestBody,
  req: Request
): Promise<IBaseResponse<IUpdateAttendanceResponseBody>> => {
  try {
    const user = req.user;
    const { present } = body;

    if (typeof present !== "boolean")
      throw new BadRequestError("Pilihan harus berupa true atau false!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    await assertCanManageClass(user, meeting.classId);

    const attendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
      include: {
        user: { select: { id: true, fullname: true, nim: true } },
      },
    });

    if (!attendance) throw new NotFoundError("Catatan presensi tidak ditemukan!");

    const deviceId = attendance.device_id;

    if (attendance.device_check === "SUDAH_DICEK")
      throw new ConflictError(ALREADY_CHECKED);

    if (attendance.device_check !== "TIDAK_BIASA" || !deviceId)
      throw new ConflictError("Presensi ini tidak perlu dicek.");

    await db.$transaction(async (tx) => {
      const { count } = await tx.trn_meeting_participants.updateMany({
        where: {
          meetingId: meetingId,
          userId: userId,
          device_check: "TIDAK_BIASA",
        },
        data: {
          status: present,
          device_check: "SUDAH_DICEK",
        },
      });

      if (count === 0) throw new ConflictError(ALREADY_CHECKED);

      if (present) await makeUsualDevice(userId, deviceId, tx);
    });

    void publishClassAssistantsEvent(
      meeting.classId,
      "attendance",
      { class_id: meeting.classId, meeting_id: meeting.id },
      [userId]
    );

    return {
      status: true,
      message: present
        ? `${attendance.user.fullname} ditandai hadir. HP ini sekarang menjadi HP biasanya.`
        : `${attendance.user.fullname} ditandai tidak hadir.`,
      data: {
        meeting_id: meeting.id,
        meeting_name: meeting.name,
        student_id: attendance.user.id,
        student_name: attendance.user.fullname,
        nim: attendance.user.nim,
        is_attended: present,
        submitted_at: attendance.createdAt,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SResetAttendance = async (
  meetingId: string,
  userId: string,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    const attendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
      include: {
        meeting: { select: { classId: true } },
      },
    });

    if (!attendance) throw new NotFoundError("Catatan presensi tidak ditemukan!");

    await assertCanManageClass(user, attendance.meeting.classId);

    await db.trn_meeting_participants.delete({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
    });

    void publishClassAssistantsEvent(
      attendance.meeting.classId,
      "attendance",
      { class_id: attendance.meeting.classId, meeting_id: meetingId },
      [userId]
    );

    return {
      status: true,
      message: "Catatan presensi berhasil dihapus",
    };
  } catch (error) {
    throw error;
  }
};
