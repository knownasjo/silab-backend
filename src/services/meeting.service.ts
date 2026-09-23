import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddClassMeetingRequestBody,
  IGetAllClassMeetingResponseBody,
  IGetMeetingQrTokenResponseBody,
} from "../interfaces/meeting.interface";
import db from "../prisma/client.prisma";
import { generateToken } from "../utils/GenerateMeetingToken/generate.token";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { getCurrentQrToken } from "../utils/QrToken/qr.token";

export const SAddClassMeeting = async (
  body: IAddClassMeetingRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const { meetingName, classId } = body;

    const user = req.user;

    if (user?.role !== "ASISTEN" && user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const isClassExist = await db.mst_class.findUnique({
      where: {
        id: classId,
      },
    });

    if (!isClassExist) throw new NotFoundError("Kelas tidak ditemukan!");

    await db.trn_meetings.create({
      data: {
        classId: classId,
        name: meetingName,
        token: generateToken(),
      },
    });

    return {
      status: true,
      message: "Pertemuan berhasil ditambahkan",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllClassMeeting = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IGetAllClassMeetingResponseBody[]>> => {
  try {
    const user = req.user;

    const isClassExist = await db.mst_class.findUnique({
      where: {
        id,
      },
    });

    if (!isClassExist) throw new NotFoundError("Kelas tidak ditemukan!");

    const isStudent = user?.role === "MAHASISWA";

    if (isStudent) {
      const isClassParticipant = await db.trn_class_participants.findFirst({
        where: { classId: isClassExist.id, userId: user.id, deleted_at: null },
      });

      if (!isClassParticipant)
        throw new ForbiddenError("Anda tidak terdaftar di kelas ini!");
    }

    const meetingsData = await db.trn_meetings.findMany({
      where: {
        classId: isClassExist.id,
        deleted_at: null,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        participants: {
          select: {
            userId: true,
            createdAt: true,
            status: true,
            user: {
              select: {
                id: true,
                nim: true,
                fullname: true,
              },
            },
          },
        },
      },
    });

    const classParticipants = isStudent
      ? []
      : await db.trn_class_participants.findMany({
          where: {
            classId: isClassExist.id,
            deleted_at: null,
          },
          include: {
            user: {
              select: {
                id: true,
                nim: true,
                fullname: true,
              },
            },
          },
        });

    const data: IGetAllClassMeetingResponseBody[] = meetingsData.map(
      (meeting) => {
        if (isStudent) {
          const ownRecord = meeting.participants.find(
            (p) => p.userId === user.id
          );

          return {
            id: meeting.id,
            meeting_name: meeting.name,
            is_open: meeting.status,
            submitted_at: ownRecord?.createdAt.toISOString() ?? null,
            is_attended: ownRecord?.status ?? false,
          };
        }

        const studentsInClass = classParticipants.map((participant) => ({
          student_id: participant.user.id,
          student_name: participant.user.fullname,
          nim: participant.user.nim,
          submitted_at: null as string | null,
          is_attended: false,
        }));

        meeting.participants.forEach((meetingParticipant) => {
          const student = studentsInClass.find(
            (s) => s.student_id === meetingParticipant.user.id
          );
          if (student) {
            student.is_attended = meetingParticipant.status;
            student.submitted_at = meetingParticipant.createdAt.toISOString();
          }
        });

        return {
          id: meeting.id,
          meeting_name: meeting.name,
          is_open: meeting.status,
          students: studentsInClass,
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

export const SGetMeetingQrToken = async (
  meetingId: string,
  req: Request
): Promise<IBaseResponse<IGetMeetingQrTokenResponseBody>> => {
  try {
    const user = req.user;

    if (user?.role !== "ASISTEN" && user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    if (!meeting.status)
      throw new ForbiddenError("Sesi presensi belum dibuka!");

    const { token, periodSeconds, expiresInMs } = getCurrentQrToken(
      meeting.id
    );

    return {
      status: true,
      message: "Berhasil",
      data: {
        token,
        period_seconds: periodSeconds,
        expires_in_ms: expiresInMs,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateMeetingStatus = async (
  meetingId: string,
  status: boolean,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "ASISTEN" && user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deleted_at: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    await db.trn_meetings.update({
      where: {
        id: meetingId,
      },
      data: {
        status: status,
        updated_at: new Date(),
      },
    });

    return {
      status: true,
      message: status
        ? "Sesi presensi dibuka"
        : "Sesi presensi ditutup",
    };
  } catch (error) {
    throw error;
  }
};
