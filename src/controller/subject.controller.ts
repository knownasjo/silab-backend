import { NextFunction, Request, Response } from "express";
import {
  SAddSubject,
  SDeleteSubject,
  SGetSubject,
  SGetSubjectById,
  SUpdateSubject,
} from "../services/subject.service";

export const CAddSubject = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddSubject(req.body, req);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetAllSubjects = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SGetSubject(req);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CGetSubjectById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const subjectId = req.params.id.toString();

    const resData = await SGetSubjectById(subjectId, req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CUpdateSubject = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SUpdateSubject(
      req.params.id.toString(),
      req.body,
      req
    );

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CDeleteSubject = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SDeleteSubject(req.params.id.toString(), req);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
