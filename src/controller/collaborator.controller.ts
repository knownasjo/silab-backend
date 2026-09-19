import { NextFunction, Request, Response } from "express";
import {
  SAddCollaborator,
  SGetCollaborators,
} from "../services/collaborator.service";

export const CAddCollaborators = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SAddCollaborator(req.body);

    res.status(201).json(resData);
  } catch (error) {
    next(error);
  }
};

export const CGetClassCollaborators = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = req.params.id;

    const resData = await SGetCollaborators(id);

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};
