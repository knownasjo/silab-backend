import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import { ILecturerDashboardResponseBody } from "../interfaces/dashboard.interface";
import db from "../prisma/client.prisma";
import { ForbiddenError } from "../utils/HttpErrors/HttptErrors";
import { isMeetingHeld } from "../utils/MeetingRules/meeting.rules";
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
        select: { status: true, _count: { select: { participants: true } } },
      },
    },
  });

  const students = new Set(
    classes.flatMap((classData) =>
      classData.participants.map((participant) => participant.userId)
    )
  );

  const totalMeeting = classes.reduce(
    (total, classData) =>
      total +
      classData.meetings.filter((meeting) =>
        isMeetingHeld(meeting.status, meeting._count.participants)
      ).length,
    0
  );

  return {
    status: true,
    message: "Berhasil",
    data: {
      totalClass: classes.length,
      totalStudent: students.size,
      totalMeeting,
    },
  };
};
