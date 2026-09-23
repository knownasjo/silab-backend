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
import { checkQrToken } from "../utils/QrToken/qr.token";

/**
 * Presensi oleh mahasiswa lewat scan QR.
 * Jalur endpoint sengaja dibuat sama dengan yang dipanggil aplikasi Flutter.
 * Token di QR berganti setiap beberapa detik (lihat utils/QrToken).
 */
export const SAddAttendance = async (
  classId: string,
  meetingId: string,
  body: IAddAttendanceRequestBody,
  req: Request
): Promise<IBaseResponse<IAddAttendanceResponseBody>> => {
  try {
    // Dicatat sebelum query database, supaya lambatnya database tidak
    // membuat token yang dipindai tepat waktu dianggap kedaluwarsa.
    const receivedAt = Date.now();

    const user = req.user;
    const { token } = body;

    if (typeof token !== "string" || !token)
      throw new BadRequestError("Token presensi wajib diisi!");

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("Hanya mahasiswa yang dapat melakukan presensi!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        classId: classId,
        deleted_at: null,
      },
    });

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

    const isClassParticipant = await db.trn_class_participants.findFirst({
      where: {
        classId: classId,
        userId: user.id,
        deleted_at: null,
      },
    });

    if (!isClassParticipant)
      throw new ForbiddenError("Anda tidak terdaftar di kelas ini!");

    const existingAttendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: user.id,
        },
      },
    });

    if (existingAttendance)
      throw new ConflictError("Anda sudah melakukan presensi untuk pertemuan ini!");

    const attendance = await db.trn_meeting_participants.create({
      data: {
        meetingId: meetingId,
        userId: user.id,
        status: true,
      },
    });

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
      throw new BadRequestError("Status kehadiran harus berupa true atau false!");

    if (user?.role !== "LABORAN" && user?.role !== "ASISTEN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

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
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const attendance = await db.trn_meeting_participants.findUnique({
      where: {
        meetingId_userId: {
          meetingId: meetingId,
          userId: userId,
        },
      },
    });

    if (!attendance) throw new NotFoundError("Catatan presensi tidak ditemukan!");

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
      message: "Catatan presensi berhasil dihapus",
    };
  } catch (error) {
    throw error;
  }
};
