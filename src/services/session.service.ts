import { Request } from "express";
import { mst_session, SessionDayGroup } from "@prisma/client";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  ISessionRequestBody,
  ISessionResponseBody,
} from "../interfaces/session.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  DAY_GROUP_LABELS,
  dayGroupOf,
  isValidTime,
  toMinutes,
} from "../utils/Schedule/schedule";

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const sessionLabel = (session: Pick<mst_session, "number" | "day_group">) =>
  `Sesi ${session.number} ${DAY_GROUP_LABELS[session.day_group]}`;

const assertLaboran = (req: Request) => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat mengatur jam sesi!");
};

const readNumber = (value: unknown) => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20)
    throw new BadRequestError("Nomor sesi harus angka 1 sampai 20!");

  return value as number;
};

const readTimes = (startAt: string, endAt: string) => {
  if (!isValidTime(startAt) || !isValidTime(endAt))
    throw new BadRequestError("Jam harus berformat JJ.MM, misalnya 07.00!");

  if (toMinutes(startAt)! >= toMinutes(endAt)!)
    throw new BadRequestError("Jam mulai harus sebelum jam selesai!");

  return { startAt, endAt };
};

const assertNoConflict = async (
  dayGroup: SessionDayGroup,
  number: number,
  startAt: string,
  endAt: string,
  exceptId?: string
) => {
  const others = await db.mst_session.findMany({
    where: { day_group: dayGroup, ...(exceptId && { id: { not: exceptId } }) },
  });

  const sameNumber = others.find((session) => session.number === number);

  if (sameNumber)
    throw new ConflictError(`${sessionLabel(sameNumber)} sudah ada!`);

  const overlap = others.find(
    (session) =>
      toMinutes(startAt)! < toMinutes(session.endAt)! &&
      toMinutes(session.startAt)! < toMinutes(endAt)!
  );

  if (overlap)
    throw new ConflictError(
      `Jam sesi bertabrakan dengan ${sessionLabel(overlap)} (${overlap.startAt}–${overlap.endAt})!`
    );
};

const toResponse = (
  session: mst_session & { _count: { classes: number } }
): ISessionResponseBody => ({
  id: session.id,
  day_group: session.day_group,
  number: session.number,
  startAt: session.startAt,
  endAt: session.endAt,
  is_active: session.is_active,
  classes: session._count.classes,
});

export const SGetSessions = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody[]>> => {
  const day = readText(req.query.day);
  const onlyActive = req.query.active === "true";

  const sessions = await db.mst_session.findMany({
    where: {
      ...(day && { day_group: dayGroupOf(day) }),
      ...(onlyActive && { is_active: true }),
    },
    include: {
      _count: { select: { classes: { where: { deleted_at: null } } } },
    },
  });

  const data = sessions
    .sort(
      (a, b) =>
        a.day_group.localeCompare(b.day_group) === 0
          ? toMinutes(a.startAt)! - toMinutes(b.startAt)!
          : a.day_group === SessionDayGroup.WEEKDAY
            ? -1
            : 1
    )
    .map(toResponse);

  return { status: true, message: "Berhasil", data };
};

export const SAddSession = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody>> => {
  assertLaboran(req);

  const body: ISessionRequestBody = req.body ?? {};
  const dayGroup = readText(body.day_group);

  if (!Object.values(SessionDayGroup).includes(dayGroup as SessionDayGroup))
    throw new BadRequestError(
      "Kelompok hari harus WEEKDAY (Senin–Kamis) atau FRIDAY (Jumat)!"
    );

  const number = readNumber(body.number);
  const { startAt, endAt } = readTimes(
    readText(body.startAt),
    readText(body.endAt)
  );

  await assertNoConflict(dayGroup as SessionDayGroup, number, startAt, endAt);

  const session = await db.mst_session.create({
    data: {
      day_group: dayGroup as SessionDayGroup,
      number,
      startAt,
      endAt,
      created_by: req.user!.id,
    },
    include: { _count: { select: { classes: true } } },
  });

  publishRealtimeEvent("session", { session_id: session.id });

  return {
    status: true,
    message: `${sessionLabel(session)} berhasil ditambahkan`,
    data: toResponse(session),
  };
};

export const SUpdateSession = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody>> => {
  assertLaboran(req);

  const session = await db.mst_session.findUnique({
    where: { id: req.params.id.toString() },
  });

  if (!session) throw new NotFoundError("Sesi tidak ditemukan!");

  const body: ISessionRequestBody = req.body ?? {};
  const number =
    body.number === undefined ? session.number : readNumber(body.number);
  const { startAt, endAt } = readTimes(
    body.startAt === undefined ? session.startAt : readText(body.startAt),
    body.endAt === undefined ? session.endAt : readText(body.endAt)
  );

  if (body.is_active !== undefined && typeof body.is_active !== "boolean")
    throw new BadRequestError("Status aktif harus berupa true atau false!");

  const isActive = body.is_active ?? session.is_active;
  const timesChanged = startAt !== session.startAt || endAt !== session.endAt;

  await assertNoConflict(session.day_group, number, startAt, endAt, session.id);

  const classes = timesChanged
    ? await db.mst_class.findMany({
        where: { sessionId: session.id },
        select: { id: true },
      })
    : [];

  const [updated] = await db.$transaction([
    db.mst_session.update({
      where: { id: session.id },
      data: {
        number,
        startAt,
        endAt,
        is_active: isActive,
        updated_by: req.user!.id,
        updated_at: new Date(),
      },
      include: {
        _count: { select: { classes: { where: { deleted_at: null } } } },
      },
    }),
    db.mst_class.updateMany({
      where: { id: { in: classes.map((item) => item.id) } },
      data: { startAt, endAt },
    }),
  ]);

  publishRealtimeEvent("session", { session_id: session.id });
  classes.forEach((item) =>
    publishRealtimeEvent("class", { class_id: item.id })
  );

  return {
    status: true,
    message: timesChanged && classes.length
      ? `${sessionLabel(updated)} berhasil diperbarui; jam ${classes.length} kelas ikut berubah`
      : `${sessionLabel(updated)} berhasil diperbarui`,
    data: toResponse(updated),
  };
};

export const SDeleteSession = async (req: Request): Promise<IBaseResponse> => {
  assertLaboran(req);

  const session = await db.mst_session.findUnique({
    where: { id: req.params.id.toString() },
    include: { _count: { select: { classes: true } } },
  });

  if (!session) throw new NotFoundError("Sesi tidak ditemukan!");

  if (session._count.classes)
    throw new ConflictError(
      `${sessionLabel(session)} dipakai ${session._count.classes} kelas. Nonaktifkan saja agar tidak muncul di pilihan kelas baru.`
    );

  await db.mst_session.delete({ where: { id: session.id } });

  publishRealtimeEvent("session", { session_id: session.id });

  return { status: true, message: `${sessionLabel(session)} berhasil dihapus` };
};
