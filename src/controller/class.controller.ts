import { NextFunction, Request, Response } from "express";
import {
  SAddClass,
  SClassRegistration,
  SGetAllClassByPaidActivations,
  SGetAllClasses,
  SGetClassById,
} from "../services/class.service";

export const CAddClass = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddClass(req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetAllClasses = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetAllClasses();

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetClassById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id.toString();

    const resData = await SGetClassById(id);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetAllClassByPaidActivations = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetAllClassByPaidActivations(req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CClassRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SClassRegistration(req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};
