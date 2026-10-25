import { Request } from "express";
import { Prisma } from "@prisma/client";
import {
  AnnouncementTypeEnum,
  IAddAnnouncementRequestBody,
  IGetAllAnnouncementsResponseBody,
} from "../interfaces/announcement.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  findActivePeriod,
  getActivePeriod,
  periodLabel,
} from "../utils/PeriodRules/period.rules";
import { rethrowIfSubjectDeleted } from "../utils/SubjectRules/subject.rules";

const MAX_BODY_LENGTH = 1000;
const MAX_TITLE_LENGTH = 150;

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const ANNOUNCEMENT_INCLUDE = {
  announcementAuthor: { select: { fullname: true } },
  period: true,
  subjects: {
    include: {
      subject: { select: { id: true, subjectName: true, subjectCode: true } },
    },
  },
} satisfies Prisma.mst_announcementInclude;

type AnnouncementWithAudience = Prisma.mst_announcementGetPayload<{
  include: typeof ANNOUNCEMENT_INCLUDE;
}>;

const toResponse = (
  data: AnnouncementWithAudience
): IGetAllAnnouncementsResponseBody => ({
  id: data.id,
  title: data.title,
  body: data.body,
  author: data.announcementAuthor.fullname,
  createdAt: data.createdAt.toISOString(),
  type: data.type as AnnouncementTypeEnum,
  forAll: data.forAll,
  subjects: data.subjects
    .map(({ subject }) => subject)
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
  period: data.period ? periodLabel(data.period) : null,
});

const visibleTo = async (
  user: Request["user"]
): Promise<Prisma.mst_announcementWhereInput> => {
  if (user?.role !== "MAHASISWA") return {};

  const period = await findActivePeriod();

  if (!period) return { forAll: true };

  return {
    OR: [
      { forAll: true },
      {
        periodId: period.id,
        subjects: {
          some: {
            subject: {
              OR: [
                {
                  subjectActivation: {
                    some: {
                      userId: user.id,
                      periodId: period.id,
                      deletedAt: null,
                    },
                  },
                },
                {
                  classes: {
                    some: {
                      periodId: period.id,
                      deletedAt: null,
                      collaborators: {
                        some: { userId: user.id, deletedAt: null },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    ],
  };
};

const readTargetSubjects = async (
  type: AnnouncementTypeEnum,
  subjectIds: unknown
) => {
  if (subjectIds === undefined || subjectIds === null) return [];

  if (
    !Array.isArray(subjectIds) ||
    subjectIds.some((subjectId) => typeof subjectId !== "string" || !subjectId)
  )
    throw new BadRequestError("Mata kuliah tujuan tidak valid!");

  const ids = [...new Set(subjectIds as string[])];

  if (ids.length === 0) return [];

  if (type !== AnnouncementTypeEnum.BASIC)
    throw new BadRequestError(
      "Pengumuman pendaftaran selalu untuk semua mahasiswa!"
    );

  const found = await db.mst_subject.count({
    where: { id: { in: ids }, deletedAt: null },
  });

  if (found !== ids.length)
    throw new NotFoundError("Mata kuliah tidak ditemukan!");

  return ids;
};

export const SAddAnnouncement = async (
  body: IAddAnnouncementRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const { type, title, body: announcementBody } = body;

    const cleanTitle = readText(title);
    const cleanBody = readText(announcementBody);

    if (cleanTitle === "")
      throw new BadRequestError("Judul pengumuman wajib diisi!");

    if (cleanBody === "")
      throw new BadRequestError("Deskripsi pengumuman wajib diisi!");

    if (cleanTitle.length > MAX_TITLE_LENGTH)
      throw new BadRequestError(
        `Judul pengumuman maksimal ${MAX_TITLE_LENGTH} karakter!`
      );

    if (cleanBody.length > MAX_BODY_LENGTH)
      throw new BadRequestError(
        `Deskripsi pengumuman maksimal ${MAX_BODY_LENGTH} karakter!`
      );

    if (!Object.values(AnnouncementTypeEnum).includes(type))
      throw new BadRequestError("Jenis pengumuman tidak valid!");

    const subjectIds = await readTargetSubjects(type, body.subjectIds);
    const period = subjectIds.length > 0 ? await getActivePeriod() : null;

    const announcement = await db.mst_announcement
      .create({
        data: {
          type: type,
          title: cleanTitle,
          body: cleanBody,
          author: user.id,
          forAll: subjectIds.length === 0,
          periodId: period?.id ?? null,
          subjects: {
            create: subjectIds.map((subjectId) => ({ subjectId })),
          },
        },
      })
      .catch(rethrowIfSubjectDeleted);

    publishRealtimeEvent("announcement", {
      announcementId: announcement.id,
      action: "created",
    });

    return {
      status: true,
      message: "Pengumuman berhasil diterbitkan",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllAnnouncements = async (
  req: Request
): Promise<IBaseResponse<IGetAllAnnouncementsResponseBody[]>> => {
  try {
    const announcementData = await db.mst_announcement.findMany({
      where: {
        deletedAt: null,
        ...(await visibleTo(req.user)),
      },
      include: ANNOUNCEMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return {
      status: true,
      message: "Berhasil",
      data: announcementData.map(toResponse),
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAnnouncementById = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IGetAllAnnouncementsResponseBody>> => {
  try {
    const data = await db.mst_announcement.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(await visibleTo(req.user)),
      },
      include: ANNOUNCEMENT_INCLUDE,
    });

    if (!data) throw new NotFoundError("Pengumuman tidak ditemukan!");

    return {
      status: true,
      message: "Berhasil",
      data: toResponse(data),
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateAnnouncement = async (
  id: string,
  body: IAddAnnouncementRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const { type, title, body: announcementBody } = body;

    const cleanTitle = readText(title);
    const cleanBody = readText(announcementBody);

    if (cleanTitle === "")
      throw new BadRequestError("Judul pengumuman wajib diisi!");

    if (cleanBody === "")
      throw new BadRequestError("Deskripsi pengumuman wajib diisi!");

    if (cleanTitle.length > MAX_TITLE_LENGTH)
      throw new BadRequestError(
        `Judul pengumuman maksimal ${MAX_TITLE_LENGTH} karakter!`
      );

    if (cleanBody.length > MAX_BODY_LENGTH)
      throw new BadRequestError(
        `Deskripsi pengumuman maksimal ${MAX_BODY_LENGTH} karakter!`
      );

    if (!Object.values(AnnouncementTypeEnum).includes(type))
      throw new BadRequestError("Jenis pengumuman tidak valid!");

    const announcement = await db.mst_announcement.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: { subjects: { select: { subjectId: true } } },
    });

    if (!announcement) throw new NotFoundError("Pengumuman tidak ditemukan!");

    const currentIds = announcement.forAll
      ? []
      : announcement.subjects.map(({ subjectId }) => subjectId);
    const targetIds =
      body.subjectIds !== undefined
        ? await readTargetSubjects(type, body.subjectIds)
        : type === AnnouncementTypeEnum.BASIC
          ? currentIds
          : [];
    const sameTargets =
      targetIds.length > 0 &&
      targetIds.length === currentIds.length &&
      targetIds.every((subjectId) => currentIds.includes(subjectId));
    const periodId =
      targetIds.length === 0
        ? null
        : sameTargets
          ? announcement.periodId
          : (await getActivePeriod()).id;

    await db.mst_announcement
      .update({
        where: { id },
        data: {
          type: type,
          title: cleanTitle,
          body: cleanBody,
          updatedAt: new Date(),
          forAll: targetIds.length === 0,
          periodId,
          subjects: {
            deleteMany: {},
            create: targetIds.map((subjectId) => ({ subjectId })),
          },
        },
      })
      .catch(rethrowIfSubjectDeleted);

    publishRealtimeEvent("announcement", {
      announcementId: id,
      action: "updated",
    });

    return {
      status: true,
      message: "Pengumuman berhasil diperbarui",
    };
  } catch (error) {
    throw error;
  }
};

export const SDeleteAnnouncement = async (
  id: string,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const announcement = await db.mst_announcement.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!announcement) throw new NotFoundError("Pengumuman tidak ditemukan!");

    await db.mst_announcement.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    publishRealtimeEvent("announcement", {
      announcementId: id,
      action: "deleted",
    });

    return {
      status: true,
      message: "Pengumuman berhasil dihapus",
    };
  } catch (error) {
    throw error;
  }
};
