import { NextFunction, Request, Response } from "express";
import {
  SAddClassMeeting,
  SGetAllClassMeeting,
} from "../services/meeting.service";

export const CAddClassMeeting = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddClassMeeting(req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetAllClassMeeting = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const classId = req.params.id.toString();

    const resData = await SGetAllClassMeeting(classId, req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};
