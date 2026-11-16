import { ActivityAction, Prisma, trn_activity_logs } from "@prisma/client";
import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IActivityListResponseBody,
  IActivityResponseBody,
} from "../interfaces/activity.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";

export const ACTIVITY_PAGE_SIZE = 50;

const MAX_KEYWORD_LENGTH = 100;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type ActivityGroup =
  | "LOGIN"
  | "PAYMENT"
  | "ATTENDANCE"
  | "MEETING"
  | "CLASS"
  | "SESSION"
  | "SUBJECT"
  | "ANNOUNCEMENT"
  | "ASSISTANT"
  | "ACCOUNT"
  | "PERIOD";

const ACTIONS: Record<ActivityAction, { label: string; group: ActivityGroup }> =
  {
    LOGIN_SUCCESS: { label: "Login berhasil", group: "LOGIN" },
    LOGIN_FAILED: { label: "Login gagal", group: "LOGIN" },
    PAYMENT_STATUS_CHANGED: { label: "Ubah status bayar", group: "PAYMENT" },
    STUDENT_CLASS_MOVED: { label: "Pindah kelas mahasiswa", group: "PAYMENT" },
    ACTIVATION_DELETED: { label: "Hapus pendaftaran", group: "PAYMENT" },
    MEETING_CREATED: { label: "Tambah pertemuan", group: "MEETING" },
    MEETING_RENAMED: { label: "Ubah judul pertemuan", group: "MEETING" },
    MEETING_DELETED: { label: "Hapus pertemuan", group: "MEETING" },
    MEETING_OPENED: { label: "Buka sesi presensi", group: "MEETING" },
    MEETING_CLOSED: { label: "Tutup sesi presensi", group: "MEETING" },
    ATTENDANCE_SET: { label: "Ubah presensi", group: "ATTENDANCE" },
    DEVICE_CHECKED: { label: "Cek HP tidak biasa", group: "ATTENDANCE" },
    ATTENDANCE_RESET: { label: "Hapus presensi", group: "ATTENDANCE" },
    CLASS_CREATED: { label: "Tambah kelas", group: "CLASS" },
    CLASS_UPDATED: { label: "Ubah kelas", group: "CLASS" },
    CLASS_DELETED: { label: "Hapus kelas", group: "CLASS" },
    SESSION_CREATED: { label: "Tambah jam sesi", group: "SESSION" },
    SESSION_UPDATED: { label: "Ubah jam sesi", group: "SESSION" },
    SESSION_DELETED: { label: "Hapus jam sesi", group: "SESSION" },
    SUBJECT_CREATED: { label: "Tambah mata kuliah", group: "SUBJECT" },
    SUBJECT_UPDATED: { label: "Ubah mata kuliah", group: "SUBJECT" },
    SUBJECT_DELETED: { label: "Hapus mata kuliah", group: "SUBJECT" },
    ANNOUNCEMENT_CREATED: { label: "Buat pengumuman", group: "ANNOUNCEMENT" },
    ANNOUNCEMENT_UPDATED: { label: "Ubah pengumuman", group: "ANNOUNCEMENT" },
    ANNOUNCEMENT_DELETED: { label: "Hapus pengumuman", group: "ANNOUNCEMENT" },
    ASSISTANT_ADDED: { label: "Tambah asisten", group: "ASSISTANT" },
    ASSISTANT_REMOVED: { label: "Hapus asisten", group: "ASSISTANT" },
    ACCOUNT_CREATED: { label: "Buat akun", group: "ACCOUNT" },
    ACCOUNT_DELETED: { label: "Hapus akun", group: "ACCOUNT" },
    REGISTRATION_DELETED: { label: "Hapus pendaftaran akun", group: "ACCOUNT" },
    PASSWORD_RESET: { label: "Ganti password akun", group: "ACCOUNT" },
    OWN_NAME_CHANGED: { label: "Ganti nama sendiri", group: "ACCOUNT" },
    OWN_PASSWORD_CHANGED: { label: "Ganti password sendiri", group: "ACCOUNT" },
    PERIOD_STARTED: { label: "Mulai semester", group: "PERIOD" },
    PERIOD_DELETED: { label: "Hapus periode", group: "PERIOD" },
  };

const GROUPS = new Set(Object.values(ACTIONS).map((info) => info.group));

const actionsOf = (group: ActivityGroup) =>
  (Object.keys(ACTIONS) as ActivityAction[]).filter(
    (action) => ACTIONS[action].group === group
  );

const readParam = (value: unknown, message: string) => {
  if (value === undefined) return "";

  if (typeof value !== "string") throw new BadRequestError(message);

  return value.trim();
};

const readDate = (value: unknown) => {
  const message = "Tanggal harus berformat YYYY-MM-DD!";
  const text = readParam(value, message);

  if (!text) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (!match) throw new BadRequestError(message);

  const [year, month, day] = match.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new BadRequestError(message);

  return utc - WIB_OFFSET_MS;
};

const readPage = (value: unknown) => {
  const message = "Nomor halaman tidak valid!";
  const text = readParam(value, message);

  if (!text) return 1;

  if (!/^[1-9]\d{0,5}$/.test(text)) throw new BadRequestError(message);

  return Number(text);
};

const toResponse = (log: trn_activity_logs): IActivityResponseBody => ({
  id: log.id,
  action: log.action,
  actionLabel: ACTIONS[log.action].label,
  group: ACTIONS[log.action].group,
  actor: {
    id: log.actorId,
    name: log.actorName,
    nim: log.actorNim,
    role: log.actorRole,
  },
  description: log.description,
  change: log.change,
  attempts: log.attempts,
  periodId: log.periodId,
  createdAt: log.createdAt.toISOString(),
  updatedAt: log.updatedAt ? log.updatedAt.toISOString() : null,
});

export const SGetActivities = async (
  req: Request
): Promise<IBaseResponse<IActivityListResponseBody>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError(
      "Hanya laboran yang dapat melihat riwayat aktivitas!"
    );

  const periodId = readParam(req.query.periodId, "Periode tidak valid!");
  const group = readParam(req.query.group, "Jenis aktivitas tidak dikenal!");
  const keyword = readParam(req.query.q, "Kata kunci tidak valid!");
  const from = readDate(req.query.from);
  const to = readDate(req.query.to);
  const page = readPage(req.query.page);

  if (group && !GROUPS.has(group as ActivityGroup))
    throw new BadRequestError("Jenis aktivitas tidak dikenal!");

  if (keyword.length > MAX_KEYWORD_LENGTH)
    throw new BadRequestError(
      `Kata kunci paling banyak ${MAX_KEYWORD_LENGTH} karakter!`
    );

  if (from !== null && to !== null && from > to)
    throw new BadRequestError(
      "Tanggal awal tidak boleh setelah tanggal akhir!"
    );

  if (
    periodId &&
    !(await db.mst_academic_period.findUnique({ where: { id: periodId } }))
  )
    throw new NotFoundError("Periode tidak ditemukan!");

  const contains = { contains: keyword, mode: "insensitive" as const };
  const where: Prisma.trn_activity_logsWhereInput = {
    ...(periodId && { periodId }),
    ...(group && { action: { in: actionsOf(group as ActivityGroup) } }),
    ...((from !== null || to !== null) && {
      createdAt: {
        ...(from !== null && { gte: new Date(from) }),
        ...(to !== null && { lt: new Date(to + DAY_MS) }),
      },
    }),
    ...(keyword && {
      OR: [
        { actorName: contains },
        { actorNim: contains },
        { description: contains },
        { change: contains },
      ],
    }),
  };

  const [total, logs] = await Promise.all([
    db.trn_activity_logs.count({ where }),
    db.trn_activity_logs.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
    }),
  ]);

  return {
    status: true,
    message: "Berhasil",
    data: {
      items: logs.map(toResponse),
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / ACTIVITY_PAGE_SIZE),
    },
  };
};
