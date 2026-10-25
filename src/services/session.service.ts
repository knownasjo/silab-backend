import { Request } from "express";
import { ClassRoom, DaysOfWeek, mst_session, Prisma } from "@prisma/client";
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
import { findMemberScheduleClashes } from "../utils/AssistantRules/assistant.rules";
import {
  DAY_LABELS,
  formatSchedule,
  isValidTime,
  toMinutes,
} from "../utils/Schedule/schedule";
import {
  assertPeriodActive,
  findActivePeriod,
  getActivePeriod,
} from "../utils/PeriodRules/period.rules";

type SessionWithCount = mst_session & { _count: { classes: number } };

type SessionPlace = Pick<mst_session, "room" | "day">;

const DAYS = Object.values(DaysOfWeek);

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const sessionLabel = (
  session: Pick<mst_session, "number" | "room" | "day">
) => `Sesi ${session.number} ${DAY_LABELS[session.day]} ${session.room}`;

const listText = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} dan ${items[items.length - 1]}`
    : items[0];

const byDay = (a: { day: DaysOfWeek }, b: { day: DaysOfWeek }) =>
  DAYS.indexOf(a.day) - DAYS.indexOf(b.day);

const sessionsLabel = (
  sessions: Pick<mst_session, "number" | "room" | "day">[]
) => {
  const [first] = sessions;

  return sessions.length === 1
    ? sessionLabel(first)
    : `Sesi ${first.number} ${first.room} hari ${listText(
        [...sessions].sort(byDay).map((session) => DAY_LABELS[session.day])
      )}`;
};

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

const readRoom = (value: unknown) => {
  const room = readText(value);

  if (!Object.values(ClassRoom).includes(room as ClassRoom))
    throw new BadRequestError("Ruangan harus PSI atau SBTI!");

  return room as ClassRoom;
};

const readDay = (value: unknown) => {
  const day = readText(value);

  if (!DAYS.includes(day as DaysOfWeek))
    throw new BadRequestError("Hari harus Senin sampai Jumat!");

  return day as DaysOfWeek;
};

const readAlsoDays = (value: unknown, day: DaysOfWeek) => {
  if (value === undefined) return [];

  if (!Array.isArray(value) || value.some((item) => !DAYS.includes(item)))
    throw new BadRequestError("Hari lain harus berisi hari Senin sampai Jumat!");

  return DAYS.filter((item) => item !== day && value.includes(item));
};

const lockSessions = async (
  tx: Prisma.TransactionClient,
  periodId: string,
  room: ClassRoom,
  days: DaysOfWeek[]
) => {
  for (const day of [...days].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${periodId}:${room}:${day}`}))`;
};

const assertNoConflict = async (
  tx: Prisma.TransactionClient,
  periodId: string,
  place: SessionPlace,
  number: number,
  startAt: string,
  endAt: string,
  exceptId?: string
) => {
  const others = await tx.mst_session.findMany({
    where: {
      periodId,
      room: place.room,
      day: place.day,
      ...(exceptId && { id: { not: exceptId } }),
    },
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

const toResponse = (session: SessionWithCount): ISessionResponseBody => ({
  id: session.id,
  room: session.room,
  day: session.day,
  number: session.number,
  startAt: session.startAt,
  endAt: session.endAt,
  isActive: session.isActive,
  classes: session._count.classes,
});

export const SGetSessions = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody[]>> => {
  const room = readText(req.query.room) ? readRoom(req.query.room) : undefined;
  const day = readText(req.query.day) ? readDay(req.query.day) : undefined;
  const onlyActive = req.query.active === "true";
  const period = await findActivePeriod();

  if (!period) return { status: true, message: "Berhasil", data: [] };

  const sessions = await db.mst_session.findMany({
    where: {
      periodId: period.id,
      ...(room && { room }),
      ...(day && { day }),
      ...(onlyActive && { isActive: true }),
    },
    include: {
      _count: { select: { classes: { where: { deletedAt: null } } } },
    },
  });

  const data = sessions
    .sort(
      (a, b) =>
        a.room.localeCompare(b.room) ||
        byDay(a, b) ||
        toMinutes(a.startAt)! - toMinutes(b.startAt)!
    )
    .map(toResponse);

  return { status: true, message: "Berhasil", data };
};

export const SAddSession = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody>> => {
  assertLaboran(req);

  const body: ISessionRequestBody = req.body ?? {};
  const room = readRoom(body.room);
  const day = readDay(body.day);
  const days = [day, ...readAlsoDays(body.alsoDays, day)];
  const number = readNumber(body.number);
  const { startAt, endAt } = readTimes(
    readText(body.startAt),
    readText(body.endAt)
  );

  const period = await getActivePeriod();

  const sessions = await db.$transaction(
    async (tx) => {
      await lockSessions(tx, period.id, room, days);

      for (const target of days)
        await assertNoConflict(
          tx,
          period.id,
          { room, day: target },
          number,
          startAt,
          endAt
        );

      const created: SessionWithCount[] = [];

      for (const target of days)
        created.push(
          await tx.mst_session.create({
            data: {
              periodId: period.id,
              room,
              day: target,
              number,
              startAt,
              endAt,
              createdBy: req.user!.id,
            },
            include: { _count: { select: { classes: true } } },
          })
        );

      return created;
    },
    { maxWait: 10000, timeout: 20000 }
  );

  sessions.forEach((session) =>
    publishRealtimeEvent("session", { sessionId: session.id })
  );

  return {
    status: true,
    message: `${sessionsLabel(sessions)} berhasil ditambahkan`,
    data: toResponse(sessions[0]),
  };
};

export const SUpdateSession = async (
  req: Request
): Promise<IBaseResponse<ISessionResponseBody> & { warnings: string[] }> => {
  assertLaboran(req);

  const id = req.params.id.toString();
  const found = await db.mst_session.findUnique({ where: { id } });

  if (!found) throw new NotFoundError("Sesi tidak ditemukan!");

  await assertPeriodActive(found.periodId);

  const body: ISessionRequestBody = req.body ?? {};
  const alsoDays = readAlsoDays(body.alsoDays, found.day);

  const { updated, classes, warnings } = await db.$transaction(
    async (tx) => {
      await lockSessions(tx, found.periodId, found.room, [
        found.day,
        ...alsoDays,
      ]);

      const session = await tx.mst_session.findUnique({ where: { id } });

      if (!session) throw new NotFoundError("Sesi tidak ditemukan!");

      const number =
        body.number === undefined ? session.number : readNumber(body.number);
      const { startAt, endAt } = readTimes(
        body.startAt === undefined ? session.startAt : readText(body.startAt),
        body.endAt === undefined ? session.endAt : readText(body.endAt)
      );

      if (body.isActive !== undefined && typeof body.isActive !== "boolean")
        throw new BadRequestError("Status aktif harus berupa true atau false!");

      const siblings = await tx.mst_session.findMany({
        where: {
          periodId: session.periodId,
          room: session.room,
          number: session.number,
          day: { in: alsoDays },
        },
      });
      const missing = alsoDays.find(
        (day) => !siblings.some((sibling) => sibling.day === day)
      );

      if (missing)
        throw new NotFoundError(
          `${sessionLabel({ ...session, day: missing })} tidak ditemukan!`
        );

      const targets = [session, ...siblings.sort(byDay)];

      for (const target of targets)
        await assertNoConflict(
          tx,
          session.periodId,
          target,
          number,
          startAt,
          endAt,
          target.id
        );

      const updated: SessionWithCount[] = [];
      const classes: Prisma.mst_classGetPayload<{
        include: { subject: { select: { subjectName: true } } };
      }>[] = [];

      for (const target of targets) {
        const moved =
          target.startAt !== startAt || target.endAt !== endAt
            ? await tx.mst_class.findMany({
                where: { sessionId: target.id, deletedAt: null },
                include: { subject: { select: { subjectName: true } } },
              })
            : [];

        updated.push(
          await tx.mst_session.update({
            where: { id: target.id },
            data: {
              number,
              startAt,
              endAt,
              isActive: body.isActive ?? target.isActive,
              updatedBy: req.user!.id,
              updatedAt: new Date(),
            },
            include: {
              _count: { select: { classes: { where: { deletedAt: null } } } },
            },
          })
        );

        if (moved.length)
          await tx.mst_class.updateMany({
            where: { id: { in: moved.map((item) => item.id) } },
            data: { startAt, endAt },
          });

        classes.push(...moved);
      }

      const warnings = new Set<string>();

      for (const item of classes) {
        const schedule = { day: item.day, startAt, endAt };
        const clashes = await findMemberScheduleClashes(
          item.id,
          schedule,
          item.periodId,
          tx
        );

        clashes.forEach((clash) =>
          warnings.add(
            `${item.subject.subjectName} kelas ${item.name} (${formatSchedule(schedule)}, ${item.room}): ${clash.member} juga ${clash.activity} ${clash.subject.subjectName} kelas ${clash.name} (${formatSchedule(clash)}, ${clash.room})`
          )
        );
      }

      return { updated, classes, warnings: [...warnings] };
    },
    { maxWait: 10000, timeout: 20000 }
  );

  updated.forEach((session) =>
    publishRealtimeEvent("session", { sessionId: session.id })
  );
  classes.forEach((item) =>
    publishRealtimeEvent("class", { classId: item.id })
  );

  const saved = classes.length
    ? `${sessionsLabel(updated)} berhasil diperbarui; jam ${classes.length} kelas ikut berubah`
    : `${sessionsLabel(updated)} berhasil diperbarui`;

  return {
    status: true,
    message: warnings.length
      ? `${saved}. Perhatian, ${warnings.length} jadwal jadi bentrok.`
      : saved,
    data: toResponse(updated[0]),
    warnings,
  };
};

export const SDeleteSession = async (req: Request): Promise<IBaseResponse> => {
  assertLaboran(req);

  const session = await db.mst_session.findUnique({
    where: { id: req.params.id.toString() },
    include: {
      _count: { select: { classes: { where: { deletedAt: null } } } },
    },
  });

  if (!session) throw new NotFoundError("Sesi tidak ditemukan!");

  await assertPeriodActive(session.periodId);

  if (session._count.classes)
    throw new ConflictError(
      `${sessionLabel(session)} dipakai ${session._count.classes} kelas. Nonaktifkan saja agar tidak muncul di pilihan kelas baru.`
    );

  await db.mst_session.delete({ where: { id: session.id } });

  publishRealtimeEvent("session", { sessionId: session.id });

  return { status: true, message: `${sessionLabel(session)} berhasil dihapus` };
};
