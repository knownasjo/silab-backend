import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddAttendanceRequestBody,
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

/**
 * Presensi oleh mahasiswa lewat scan QR.
 * Jalur endpoint sengaja dibuat sama dengan yang dipanggil aplikasi Flutter.
 */
export const SAddAttendance = async (
  classId: string,
  meetingId: string,
  body: IAddAttendanceRequestBody,
  req: Request
): Promise<IBaseResponse<IAddAttendanceResponseBody>> => {
  try {
    const user = req.user;
    const { token } = body;

    if (!token) throw new BadRequestError("Token is required!");

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("Only students can submit attendance!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        classId: classId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Meeting not found!");

    if (!meeting.status)
      throw new ForbiddenError("Attendance session is not open!");

    if (meeting.token !== token)
      throw new BadRequestError("Invalid attendance token!");

    const isClassParticipant = await db.trn_class_participants.findFirst({
      where: {
        classId: classId,
        userId: user.id,
        deleted_at: null,
      },
    });

    if (!isClassParticipant)
      throw new ForbiddenError("You are not registered in this class!");

    const existingAttendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: user.id,
        },
      },
    });

    if (existingAttendance)
      throw new ConflictError("You have already submitted attendance!");

    const attendance = await db.trn_meeting_participants.create({
      data: {
        meetingId: meetingId,
        userId: user.id,
        status: true,
      },
    });

    return {
      status: true,
      message: "Attendance recorded",
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

/**
 * Ubah status kehadiran seorang mahasiswa secara manual.
 * Dipakai laboran/asisten saat scan gagal atau perlu koreksi.
 * Membuat catatan baru bila belum ada, memperbarui bila sudah ada.
 */
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
      throw new BadRequestError("Field 'status' must be true or false!");

    if (user?.role !== "LABORAN" && user?.role !== "ASISTEN")
      throw new UnauthorizedError("User not allowed!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Meeting not found!");

    const student = await db.mst_user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!student) throw new NotFoundError("Student not found!");

    const isClassParticipant = await db.trn_class_participants.findFirst({
      where: {
        classId: meeting.classId,
        userId: userId,
        deleted_at: null,
      },
    });

    if (!isClassParticipant)
      throw new ForbiddenError("Student is not registered in this class!");

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

    return {
      status: true,
      message: status
        ? "Student marked as attended"
        : "Student marked as absent",
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

/**
 * Hapus catatan kehadiran seorang mahasiswa pada satu pertemuan,
 * mengembalikannya ke keadaan "Belum Presensi".
 */
export const SResetAttendance = async (
  meetingId: string,
  userId: string,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "LABORAN" && user?.role !== "ASISTEN")
      throw new UnauthorizedError("User not allowed!");

    const attendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
    });

    if (!attendance) throw new NotFoundError("Attendance record not found!");

    await db.trn_meeting_participants.delete({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
    });

    return {
      status: true,
      message: "Attendance record removed",
    };
  } catch (error) {
    throw error;
  }
};
