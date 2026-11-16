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
import { ActivityAction, Prisma } from "@prisma/client";
import {
  CLASS_LOG_SELECT,
  attendanceLabel,
  changeText,
  classLabel,
  personLabel,
  recordActivity,
  staffActor,
} from "../utils/ActivityLog/activity.log";

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
          deletedAt: null,
        },
      }),
      db.trn_class_participants.findFirst({
        where: {
          classId: classId,
          userId: user.id,
          deletedAt: null,
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

    const deviceId = requireDeviceId(body.deviceId);

    const isKnownDevice = devices.some(
      (device) => device.deviceId === deviceId
    );
    const isUsual = isUsualDevice(devices, deviceId);

    const attendance = await db.trn_meeting_participants
      .create({
        data: {
          meetingId: meetingId,
          userId: user.id,
          status: true,
          deviceId: deviceId,
          deviceCheck: isUsual ? "BIASA" : "TIDAK_BIASA",
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
      { classId: meeting.classId, meetingId: meeting.id },
      [user.id]
    );

    return {
      status: true,
      message: "Presensi berhasil dicatat",
      data: {
        meetingId: meeting.id,
        meetingName: meeting.name,
        studentName: user.fullname,
        nim: user.nim,
        submittedAt: attendance.createdAt,
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
        deletedAt: null,
      },
      include: { class: { select: CLASS_LOG_SELECT } },
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
        deletedAt: null,
      },
    });

    if (!isClassParticipant)
      throw new ForbiddenError("Mahasiswa tidak terdaftar di kelas ini!");

    const attendance = await db.$transaction(async (tx) => {
      const previous = await tx.trn_meeting_participants.findUnique({
        where: {
          meetingId_userId: {
            meetingId: meetingId,
            userId: userId,
          },
        },
        select: { status: true },
      });

      const saved = await tx.trn_meeting_participants.upsert({
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

      if (previous?.status !== status)
        await recordActivity(
          tx,
          {
            action: ActivityAction.ATTENDANCE_SET,
            actor: staffActor(user!),
            description: `${personLabel(student)} · ${classLabel(meeting.class)} · ${meeting.name}`,
            change: `${attendanceLabel(previous?.status)} → ${attendanceLabel(status)}`,
            targetNim: student.nim,
          },
          meeting.class.periodId
        );

      return saved;
    });

    void publishClassAssistantsEvent(
      meeting.classId,
      "attendance",
      { classId: meeting.classId, meetingId: meeting.id },
      [student.id]
    );

    return {
      status: true,
      message: status
        ? "Mahasiswa ditandai hadir"
        : "Mahasiswa ditandai tidak hadir",
      data: {
        meetingId: meeting.id,
        meetingName: meeting.name,
        studentId: student.id,
        studentName: student.fullname,
        nim: student.nim,
        isAttended: attendance.status,
        submittedAt: attendance.createdAt,
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
        deletedAt: null,
      },
      include: { class: { select: CLASS_LOG_SELECT } },
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

    const deviceId = attendance.deviceId;

    if (attendance.deviceCheck === "SUDAH_DICEK")
      throw new ConflictError(ALREADY_CHECKED);

    if (attendance.deviceCheck !== "TIDAK_BIASA" || !deviceId)
      throw new ConflictError("Presensi ini tidak perlu dicek.");

    await db.$transaction(async (tx) => {
      const { count } = await tx.trn_meeting_participants.updateMany({
        where: {
          meetingId: meetingId,
          userId: userId,
          deviceCheck: "TIDAK_BIASA",
        },
        data: {
          status: present,
          deviceCheck: "SUDAH_DICEK",
        },
      });

      if (count === 0) throw new ConflictError(ALREADY_CHECKED);

      if (present) await makeUsualDevice(userId, deviceId, tx);

      const statusChange =
        attendance.status !== present &&
        `${attendanceLabel(attendance.status)} → ${attendanceLabel(present)}`;

      await recordActivity(
        tx,
        {
          action: ActivityAction.DEVICE_CHECKED,
          actor: staffActor(user!),
          description: `${personLabel(attendance.user)} · ${classLabel(meeting.class)} · ${meeting.name}`,
          change: present
            ? changeText(["Ada", statusChange, "HP ini menjadi HP biasanya"])
            : changeText(["Tidak ada", statusChange]),
          targetNim: attendance.user.nim,
        },
        meeting.class.periodId
      );
    });

    void publishClassAssistantsEvent(
      meeting.classId,
      "attendance",
      { classId: meeting.classId, meetingId: meeting.id },
      [userId]
    );

    return {
      status: true,
      message: present
        ? `${attendance.user.fullname} ditandai hadir. HP ini sekarang menjadi HP biasanya.`
        : `${attendance.user.fullname} ditandai tidak hadir.`,
      data: {
        meetingId: meeting.id,
        meetingName: meeting.name,
        studentId: attendance.user.id,
        studentName: attendance.user.fullname,
        nim: attendance.user.nim,
        isAttended: present,
        submittedAt: attendance.createdAt,
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
        meeting: {
          select: {
            classId: true,
            name: true,
            class: { select: CLASS_LOG_SELECT },
          },
        },
        user: { select: { fullname: true, nim: true } },
      },
    });

    if (!attendance) throw new NotFoundError("Catatan presensi tidak ditemukan!");

    await assertCanManageClass(user, attendance.meeting.classId);

    await db.$transaction(async (tx) => {
      await tx.trn_meeting_participants.delete({
        where: {
          meetingId_userId: {
            meetingId: meetingId,
            userId: userId,
          },
        },
      });

      await recordActivity(
        tx,
        {
          action: ActivityAction.ATTENDANCE_RESET,
          actor: staffActor(user!),
          description: `${personLabel(attendance.user)} · ${classLabel(attendance.meeting.class)} · ${attendance.meeting.name}`,
          change: `${attendanceLabel(attendance.status)} → ${attendanceLabel(null)}`,
          targetNim: attendance.user.nim,
        },
        attendance.meeting.class.periodId
      );
    });

    void publishClassAssistantsEvent(
      attendance.meeting.classId,
      "attendance",
      { classId: attendance.meeting.classId, meetingId: meetingId },
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
