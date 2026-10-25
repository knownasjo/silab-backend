import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import { ILecturerDashboardResponseBody } from "../interfaces/dashboard.interface";
import db from "../prisma/client.prisma";
import { ForbiddenError } from "../utils/HttpErrors/HttptErrors";
import { resolveViewPeriod } from "../utils/PeriodRules/period.rules";

export const SGetLecturerDashboard = async (
  req: Request
): Promise<IBaseResponse<ILecturerDashboardResponseBody>> => {
  const user = req.user;

  if (user?.role !== "DOSEN")
    throw new ForbiddenError("Ringkasan ini hanya untuk dosen!");

  const period = await resolveViewPeriod(req);

  const classes = await db.mst_class.findMany({
    where: {
      deletedAt: null,
      periodId: period?.id ?? "",
      subject: { lecturerId: user.id },
    },
    select: {
      participants: { where: { deletedAt: null }, select: { userId: true } },
      meetings: {
        where: { deletedAt: null },
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
    totalMeeting += classData.meetings.length;
    totalExpected += studentIds.size * classData.meetings.length;
    classData.meetings.forEach((meeting) => {
      totalAttended += meeting.participants.filter((participant) =>
        studentIds.has(participant.userId)
      ).length;
    });
  });

  return {
    status: true,
    message: "Berhasil",
    data: {
      totalClass: classes.length,
      totalStudent: students.size,
      totalMeeting: totalMeeting,
      totalAttended: totalAttended,
      totalExpectedAttendance: totalExpected,
      attendanceRate: totalExpected
        ? Math.round((totalAttended / totalExpected) * 100)
        : null,
    },
  };
};
