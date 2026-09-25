import { NextFunction, Request, Response } from "express";
import {
  SAddClass,
  SClassRegistration,
  SDeleteClass,
  SGetAllClassByPaidActivations,
  SGetAllClasses,
  SGetClassById,
  SGetClassmates,
  SGetMyClasses,
  SUpdateClass,
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

export const CUpdateClass = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SUpdateClass(req.params.id.toString(), req.body, req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CDeleteClass = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SDeleteClass(req.params.id.toString(), req);

    res.status(200).json(resData);
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
    const resData = await SGetAllClasses(req);

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

    const resData = await SGetClassById(id, req);

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

export const CGetMyClasses = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetMyClasses(req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetClassmates = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetClassmates(req.params.id.toString(), req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};
