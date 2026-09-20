import { NextFunction, Request, Response } from "express";
import {
  SAddAttendance,
  SResetAttendance,
  SUpdateAttendanceManually,
} from "../services/attendance.service";

export const CAddAttendance = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const classId = req.params.classId.toString();
    const meetingId = req.params.meetingId.toString();

    const resData = await SAddAttendance(classId, meetingId, req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CUpdateAttendanceManually = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const meetingId = req.params.id.toString();
    const userId = req.params.userId.toString();

    const resData = await SUpdateAttendanceManually(
      meetingId,
      userId,
      req.body,
      req
    );

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CResetAttendance = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const meetingId = req.params.id.toString();
    const userId = req.params.userId.toString();

    const resData = await SResetAttendance(meetingId, userId, req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};
