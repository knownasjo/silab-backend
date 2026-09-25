import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import { ILecturerDashboardResponseBody } from "../interfaces/dashboard.interface";
import db from "../prisma/client.prisma";
import { ForbiddenError } from "../utils/HttpErrors/HttptErrors";

export const SGetLecturerDashboard = async (
  req: Request
): Promise<IBaseResponse<ILecturerDashboardResponseBody>> => {
  const user = req.user;

  if (user?.role !== "DOSEN")
    throw new ForbiddenError("Ringkasan ini hanya untuk dosen!");

  const classes = await db.mst_class.findMany({
    where: { deleted_at: null, subject: { lecturer_id: user.id } },
    select: {
      participants: { where: { deleted_at: null }, select: { userId: true } },
      trn_meetings: {
        where: { deleted_at: null },
        select: {
          participants: { where: { status: true }, select: { userId: true } },
        },
      },
    },
  });

  const students = new Set<string>();
  let totalMeeting = 0;
  let totalAttended = 0;
  let totalExpected = 0;

  classes.forEach((classData) => {
    const studentIds = new Set(
      classData.participants.map((participant) => participant.userId)
    );

    studentIds.forEach((studentId) => students.add(studentId));
    totalMeeting += classData.trn_meetings.length;
    totalExpected += studentIds.size * classData.trn_meetings.length;
    classData.trn_meetings.forEach((meeting) => {
      totalAttended += meeting.participants.filter((participant) =>
        studentIds.has(participant.userId)
      ).length;
    });
  });

  return {
    status: true,
    message: "Berhasil",
    data: {
      total_class: classes.length,
      total_student: students.size,
      total_meeting: totalMeeting,
      total_attended: totalAttended,
      total_expected_attendance: totalExpected,
      attendance_rate: totalExpected
        ? Math.round((totalAttended / totalExpected) * 100)
        : null,
    },
  };
};
