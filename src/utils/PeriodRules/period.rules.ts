import { AcademicTerm, mst_academic_period, Prisma } from "@prisma/client";
import { Request } from "express";
import db from "../../prisma/client.prisma";
import { ConflictError, NotFoundError } from "../HttpErrors/HttptErrors";

type Client = Prisma.TransactionClient;

export const TERM_LABELS: Record<AcademicTerm, string> = {
  GANJIL: "Ganjil",
  GENAP: "Genap",
};

export const periodLabel = (
  period: Pick<mst_academic_period, "year" | "term">
) => `${period.year} ${TERM_LABELS[period.term]}`;

export const LATEST_PERIOD_FIRST: Prisma.mst_academic_periodOrderByWithRelationInput[] =
  [{ year: "desc" }, { term: "desc" }];

export const findActivePeriod = (client: Client = db) =>
  client.mst_academic_period.findFirst({ orderBy: LATEST_PERIOD_FIRST });

export const getActivePeriod = async (client: Client = db) => {
  const period = await findActivePeriod(client);

  if (!period)
    throw new ConflictError(
      "Belum ada periode akademik. Laboran perlu memulai semester terlebih dahulu!"
    );

  return period;
};

export const assertPeriodActive = async (
  periodId: string,
  client: Client = db
) => {
  const active = await getActivePeriod(client);

  if (periodId === active.id) return active;

  const period = await client.mst_academic_period.findUnique({
    where: { id: periodId },
  });

  throw new ConflictError(
    `Periode ${period ? periodLabel(period) : "ini"} sudah selesai, data hanya bisa dilihat.`
  );
};

export const assertClassInActivePeriod = async (
  classId: string,
  client: Client = db
) => {
  const classData = await client.mst_class.findUnique({
    where: { id: classId },
    select: { periodId: true },
  });

  if (!classData) throw new NotFoundError("Kelas tidak ditemukan!");

  return assertPeriodActive(classData.periodId, client);
};

export const resolveViewPeriod = async (req: Request) => {
  const requested = req.query.periodId;
  const isStaff = req.user?.role === "LABORAN" || req.user?.role === "DOSEN";

  if (!isStaff || typeof requested !== "string" || !requested)
    return findActivePeriod();

  const period = await db.mst_academic_period.findUnique({
    where: { id: requested },
  });

  if (!period) throw new NotFoundError("Periode tidak ditemukan!");

  return period;
};
