import { NextFunction, Request, Response } from "express";
import {
  SCreateUser,
  SGetUser,
  SResetUserPassword,
} from "../services/user.service";

export const CGetUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query = req.query.name?.toString();

    const resData = await SGetUser(req, query);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CCreateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SCreateUser(req);

    res.status(201).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CResetUserPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SResetUserPassword(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
