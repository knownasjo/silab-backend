import { NextFunction, Request, Response } from "express";
import {
  SAddClassMeeting,
  SGetAllClassMeeting,
  SGetMeetingQrToken,
  SUpdateMeetingStatus,
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

export const CGetMeetingQrToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const meetingId = req.params.id.toString();

    const resData = await SGetMeetingQrToken(meetingId, req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CUpdateMeetingStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const meetingId = req.params.id.toString();
    const status = Boolean(req.body.status);

    const resData = await SUpdateMeetingStatus(meetingId, status, req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};
