import { Request, Response, NextFunction } from "express";
import { BaseError } from "../utils/BaseErrors/BaseErrors";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err instanceof BaseError ? err.statusCode : 500;

  res.status(statusCode).json({
    status: false,
    message: err.message || "Internal Server Error",
  });
};
