import { NextFunction, Request, Response } from "express";
import { SGetPeriods, SStartPeriod } from "../services/period.service";

export const CGetPeriods = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetPeriods();

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CStartPeriod = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SStartPeriod(req);

    res.status(201).json(resData);
  } catch (error) {
    next(error);
  }
};
