import { Request } from "express";
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

const MAX_BODY_LENGTH = 200;
const MAX_TITLE_LENGTH = 150;

export const SAddAnnouncement = async (
  body: IAddAnnouncementRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("Anda tidak memiliki akses!");

    const { type, title, body: announcementBody } = body;

    const cleanTitle = (title ?? "").trim();
    const cleanBody = (announcementBody ?? "").trim();

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

    await db.mst_announcement.create({
      data: {
        type: type,
        title: cleanTitle,
        body: cleanBody,
        author: user.id,
      },
    });

    return {
      status: true,
      message: "Pengumuman berhasil diterbitkan",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllAnnouncements = async (): Promise<
  IBaseResponse<IGetAllAnnouncementsResponseBody[]>
> => {
  try {
    const announcementData = await db.mst_announcement.findMany({
      where: {
        deleted_at: null,
      },
      include: { announcementAuthor: { select: { fullname: true } } },
    });

    const data: IGetAllAnnouncementsResponseBody[] = announcementData.map(
      (data) => ({
        id: data.id,
        title: data.title,
        body: data.body,
        author: data.announcementAuthor.fullname,
        created_at: data.createdAt.toISOString(),
        type: data.type as AnnouncementTypeEnum,
      })
    );

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAnnouncementById = async (
  id: string
): Promise<IBaseResponse<IGetAllAnnouncementsResponseBody>> => {
  try {
    const data = await db.mst_announcement.findUnique({
      where: {
        id,
        deleted_at: null,
      },
      include: { announcementAuthor: { select: { fullname: true } } },
    });

    if (!data) throw new NotFoundError("Announcement not found!");

    return {
      status: true,
      message: "Success",
      data: {
        id: data.id,
        title: data.title,
        body: data.body,
        author: data.announcementAuthor.fullname,
        created_at: data.createdAt.toISOString(),
        type: data.type as AnnouncementTypeEnum,
      },
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

    const cleanTitle = (title ?? "").trim();
    const cleanBody = (announcementBody ?? "").trim();

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
        deleted_at: null,
      },
    });

    if (!announcement) throw new NotFoundError("Pengumuman tidak ditemukan!");

    await db.mst_announcement.update({
      where: { id },
      data: {
        type: type,
        title: cleanTitle,
        body: cleanBody,
        updated_at: new Date(),
      },
    });

    return {
      status: true,
      message: "Pengumuman berhasil diperbarui",
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Menghapus pengumuman secara soft delete: barisnya tetap tersimpan di
 * database dengan deleted_at terisi, dan seluruh query pengumuman sudah
 * menyaring deleted_at: null sehingga tidak lagi tampil.
 */
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
        deleted_at: null,
      },
    });

    if (!announcement) throw new NotFoundError("Pengumuman tidak ditemukan!");

    await db.mst_announcement.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });

    return {
      status: true,
      message: "Pengumuman berhasil dihapus",
    };
  } catch (error) {
    throw error;
  }
};
