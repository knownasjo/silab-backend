import { AcademicTerm } from "@prisma/client";
import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IPeriodResponseBody,
  IStartPeriodRequestBody,
  IStartPeriodResponseBody,
} from "../interfaces/period.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ForbiddenError,
} from "../utils/HttpErrors/HttptErrors";
import {
  findActivePeriod,
  LATEST_PERIOD_FIRST,
  periodLabel,
} from "../utils/PeriodRules/period.rules";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";

const readFirstPeriod = (body: IStartPeriodRequestBody) => {
  const year = typeof body?.year === "string" ? body.year.trim() : "";
  const years = /^(\d{4})\/(\d{4})$/.exec(year);

  if (!years || Number(years[2]) !== Number(years[1]) + 1)
    throw new BadRequestError("Tahun ajaran harus seperti 2026/2027!");

  if (!Object.values(AcademicTerm).includes(body?.term as AcademicTerm))
    throw new BadRequestError("Semester harus GANJIL atau GENAP!");

  return { year, term: body.term as AcademicTerm };
};

const nextPeriodOf = (period: { year: string; term: AcademicTerm }) => {
  if (period.term === AcademicTerm.GANJIL)
    return { year: period.year, term: AcademicTerm.GENAP };

  const start = Number(period.year.split("/")[1]);

  return { year: `${start}/${start + 1}`, term: AcademicTerm.GANJIL };
};

export const SGetPeriods = async (): Promise<
  IBaseResponse<IPeriodResponseBody[]>
> => {
  const periods = await db.mst_academic_period.findMany({
    orderBy: LATEST_PERIOD_FIRST,
    include: {
      _count: {
        select: {
          classes: { where: { deleted_at: null } },
          activations: { where: { deleted_at: null } },
        },
      },
    },
  });

  return {
    status: true,
    message: "Berhasil",
    data: periods.map((period, index) => ({
      id: period.id,
      year: period.year,
      term: period.term,
      name: periodLabel(period),
      is_active: index === 0,
      classes: period._count.classes,
      activations: period._count.activations,
    })),
  };
};

export const SStartPeriod = async (
  req: Request
): Promise<IBaseResponse<IStartPeriodResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat memulai semester baru!");

  const { previous, period, closedMeetings } = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('academic-period'))`;

      const previous = await findActivePeriod(tx);
      const next = previous
        ? nextPeriodOf(previous)
        : readFirstPeriod(req.body);
      const period = await tx.mst_academic_period.create({
        data: { ...next, created_by: req.user!.id },
      });
      const sessions = previous
        ? await tx.mst_session.findMany({ where: { periodId: previous.id } })
        : [];

      await tx.mst_session.createMany({
        data: sessions.map((session) => ({
          periodId: period.id,
          day_group: session.day_group,
          number: session.number,
          startAt: session.startAt,
          endAt: session.endAt,
          is_active: session.is_active,
          created_by: req.user!.id,
        })),
      });
      const closed = previous
        ? await tx.trn_meetings.updateMany({
            where: {
              status: true,
              deleted_at: null,
              class: { periodId: previous.id },
            },
            data: { status: false, updated_at: new Date() },
          })
        : { count: 0 };

      return { previous, period, closedMeetings: closed.count };
    }
  );

  const name = periodLabel(period);

  publishRealtimeEvent("period", { period_id: period.id, action: "started" });

  return {
    status: true,
    message:
      previous && closedMeetings > 0
        ? `Semester ${name} dimulai; ${closedMeetings} sesi presensi yang masih terbuka di ${periodLabel(previous)} ditutup`
        : `Semester ${name} dimulai`,
    data: { id: period.id, name, closed_meetings: closedMeetings },
  };
};
