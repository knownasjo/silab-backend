import { NextFunction, Request, Response } from "express";
import {
  SAddSubject,
  SGetSubject,
  SGetSubjectById,
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
    const resData = await SGetSubject();

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

    const resData = await SGetSubjectById(subjectId);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
