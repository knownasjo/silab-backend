import { NextFunction, Request, Response } from "express";
import { SGetActivities } from "../services/activity.service";

export const CGetActivities = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetActivities(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
