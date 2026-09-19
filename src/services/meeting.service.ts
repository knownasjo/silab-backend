import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddClassMeetingRequestBody,
  IGetAllClassMeetingResponseBody,
} from "../interfaces/meeting.interface";
import db from "../prisma/client.prisma";
import { generateToken } from "../utils/GenerateMeetingToken/generate.token";
import {
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";

export const SAddClassMeeting = async (
  body: IAddClassMeetingRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const { meetingName, classId } = body;

    const user = req.user;

    if (user?.role !== "ASISTEN" && user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed!");

    const isClassExist = await db.mst_class.findUnique({
      where: {
        id: classId,
      },
    });

    if (!isClassExist) throw new NotFoundError("Class not found!");

    await db.trn_meetings.create({
      data: {
        classId: classId,
        name: meetingName,
        token: generateToken(),
      },
    });

    return {
      status: true,
      message: "Class meeting added",
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

    if (!isClassExist) throw new NotFoundError("Class not found!");

    const meetingsData = await db.trn_meetings.findMany({
      where: {
        classId: isClassExist.id,
        deleted_at: null,
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

    const classParticipants = await db.trn_class_participants.findMany({
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
        const studentsInClass = classParticipants.map((participant) => ({
          student_id: participant.user.id,
          student_name: participant.user.fullname,
          nim: participant.user.nim,
          submitted_at: null,
          is_attended: false,
        }));

        meeting.participants.forEach((meetingParticipant) => {
          const student = studentsInClass.find(
            (s) => s.student_id === meetingParticipant.user.id
          );
          if (student) {
            student.is_attended = meetingParticipant.status;
          }
        });

        return {
          id: meeting.id,
          meeting_name: meeting.name,
          token: user?.role === "MAHASISWA" ? undefined : meeting.token,
          students: user?.role === "MAHASISWA" ? undefined : studentsInClass,
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
