import { Request, Response, NextFunction } from "express";
import { BaseError } from "../utils/BaseErrors/BaseErrors";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof BaseError) {
    res.status(err.statusCode).json({
      status: false,
      message: err.message,
      ...(err.data !== undefined && { data: err.data }),
    });
    return;
  }

  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ status: false, message: "Format JSON tidak valid!" });
    return;
  }

  console.error(err);
  res.status(500).json({
    status: false,
    message: "Terjadi kesalahan pada server.",
  });
};
