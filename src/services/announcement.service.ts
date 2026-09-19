import { Request } from "express";
import {
  AnnouncementTypeEnum,
  IAddAnnouncementRequestBody,
  IGetAllAnnouncementsResponseBody,
} from "../interfaces/announcement.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import { NotFoundError } from "../utils/HttpErrors/HttptErrors";

export const SAddAnnouncement = async (
  body: IAddAnnouncementRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    await db.mst_announcement.create({
      data: {
        ...body,
        author: user?.id!,
      },
    });

    return {
      status: true,
      message: "Announcement Added",
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
