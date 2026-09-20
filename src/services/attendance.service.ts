import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddAttendanceRequestBody,
  IAddAttendanceResponseBody,
} from "../interfaces/attendance.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";

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
