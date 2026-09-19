import { NextFunction, Request, Response } from "express";
import {
  SAddStudentActivation,
  SGetAllActivations,
  SUpdateActivationPaymentStatus,
} from "../services/activation.service";

export const CAddActivation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddStudentActivation(req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetAllActivations = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetAllActivations(req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CUpdateActivationPaymentStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SUpdateActivationPaymentStatus(req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
