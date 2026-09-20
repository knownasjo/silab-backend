import { NextFunction, Request, Response } from "express";
import {
  SAddAnnouncement,
  SDeleteAnnouncement,
  SGetAllAnnouncements,
  SGetAnnouncementById,
  SUpdateAnnouncement,
} from "../services/announcement.service";

export const CAddAnnouncement = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddAnnouncement(req.body, req);

    res.status(201).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CGetAllAnnouncements = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetAllAnnouncements();

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CGetAnnouncementById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id.toString();

    const resData = await SGetAnnouncementById(id);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CUpdateAnnouncement = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id.toString();

    const resData = await SUpdateAnnouncement(id, req.body, req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CDeleteAnnouncement = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id.toString();

    const resData = await SDeleteAnnouncement(id, req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
