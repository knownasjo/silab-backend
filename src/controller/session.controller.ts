import { NextFunction, Request, Response } from "express";
import {
  SAddSession,
  SDeleteSession,
  SGetSessions,
  SUpdateSession,
} from "../services/session.service";

export const CGetSessions = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetSessions(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CAddSession = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddSession(req);

    res.status(201).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CUpdateSession = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SUpdateSession(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CDeleteSession = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SDeleteSession(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
