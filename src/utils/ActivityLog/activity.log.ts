import {
  ActivityAction,
  ActivityActorRole,
  mst_user,
  Prisma,
  UserRole,
} from "@prisma/client";
import db from "../../prisma/client.prisma";
import { findActivePeriod } from "../PeriodRules/period.rules";

type Client = Prisma.TransactionClient;

export interface IActivityActor {
  id: string | null;
  name: string;
  nim: string | null;
  role: ActivityActorRole;
}

export interface IActivityEntry {
  action: ActivityAction;
  actor: IActivityActor;
  description: string;
  change?: string | null;
  targetNim?: string | null;
}

export const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000;

export const TERMINAL_ACTOR: IActivityActor = {
  id: null,
  name: "Lewat terminal",
  nim: null,
  role: ActivityActorRole.TERMINAL,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  MAHASISWA: "Mahasiswa",
  LABORAN: "Laboran",
  ASISTEN: "Asisten",
  DOSEN: "Dosen",
};

export const PAYMENT_LABELS = {
  paid: "Sudah Bayar",
  unpaid: "Belum Bayar",
};

export const paymentLabel = (paid: boolean) =>
  paid ? PAYMENT_LABELS.paid : PAYMENT_LABELS.unpaid;

export const attendanceLabel = (status: boolean | null | undefined) =>
  status === true
    ? "Hadir"
    : status === false
      ? "Tidak Hadir"
      : "Belum Presensi";

export const isStaff = (user: Pick<mst_user, "role">) =>
  user.role === UserRole.LABORAN || user.role === UserRole.DOSEN;

export const staffActor = (
  user: Pick<mst_user, "id" | "fullname" | "nim" | "role">
): IActivityActor => ({
  id: user.id,
  name: user.fullname,
  nim: user.nim,
  role:
    user.role === UserRole.LABORAN
      ? ActivityActorRole.LABORAN
      : user.role === UserRole.DOSEN
        ? ActivityActorRole.DOSEN
        : ActivityActorRole.ASISTEN,
});

export const personLabel = (person: { fullname: string; nim: string }) =>
  `${person.fullname} (${person.nim})`;

export const accountLabel = (
  person: Pick<mst_user, "fullname" | "nim" | "role">
) => `${personLabel(person)} · ${ROLE_LABELS[person.role]}`;

export const CLASS_LOG_SELECT = {
  name: true,
  periodId: true,
  subject: { select: { subjectName: true } },
} satisfies Prisma.mst_classSelect;

export const classLabel = (item: {
  name: string;
  subject: { subjectName: string };
}) => `${item.subject.subjectName} kelas ${item.name}`;

export const fromTo = (label: string, before: unknown, after: unknown) =>
  before !== after && `${label} ${before} → ${after}`;

export const changeText = (parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join("; ") || null;

export const countsText = (counts: [number, string][]) => {
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);

  return parts.length ? `ikut terhapus: ${parts.join(", ")}` : null;
};

export const activityData = (
  entry: IActivityEntry,
  periodId: string | null
): Prisma.trn_activity_logsCreateManyInput => ({
  action: entry.action,
  actorId: entry.actor.id,
  actorName: entry.actor.name,
  actorNim: entry.actor.nim,
  actorRole: entry.actor.role,
  targetNim: entry.targetNim ?? null,
  periodId,
  description: entry.description,
  change: entry.change ?? null,
});

export const activePeriodId = async (client: Client = db) =>
  (await findActivePeriod(client))?.id ?? null;

export const recordActivity = async (
  client: Client,
  entry: IActivityEntry,
  periodId?: string | null
) =>
  client.trn_activity_logs.create({
    data: activityData(
      entry,
      periodId !== undefined ? periodId : await activePeriodId(client)
    ),
  });

export const recordFailedLogin = (user: mst_user) =>
  db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login-failed:${user.id}`}))`;

    const { count } = await tx.trn_activity_logs.updateMany({
      where: {
        actorId: user.id,
        action: ActivityAction.LOGIN_FAILED,
        createdAt: { gte: new Date(Date.now() - FAILED_LOGIN_WINDOW_MS) },
      },
      data: { attempts: { increment: 1 }, updatedAt: new Date() },
    });

    if (count === 0)
      await recordActivity(tx, {
        action: ActivityAction.LOGIN_FAILED,
        actor: staffActor(user),
        description: "Password salah",
      });
  });
