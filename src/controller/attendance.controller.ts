import { NextFunction, Request, Response } from "express";
import { SAddAttendance } from "../services/attendance.service";

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
