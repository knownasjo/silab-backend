import { NextFunction, Request, Response } from "express";
import { SGetLecturerDashboard } from "../services/dashboard.service";

export const CGetLecturerDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetLecturerDashboard(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
