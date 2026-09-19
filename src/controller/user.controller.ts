import { NextFunction, Request, Response } from "express";
import { SGetUser } from "../services/user.service";

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
