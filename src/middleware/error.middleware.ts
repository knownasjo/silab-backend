import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { BaseError } from "../utils/BaseErrors/BaseErrors";

const DATABASE_BUSY_CODES = ["P2024", "P2028"];

const isDatabaseBusy = (err: Error) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  DATABASE_BUSY_CODES.includes(err.code);

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

  if (isDatabaseBusy(err)) {
    res.status(503).json({
      status: false,
      message: "Server sedang sibuk, silakan coba lagi sebentar lagi.",
    });
    return;
  }

  res.status(500).json({
    status: false,
    message: "Terjadi kesalahan pada server.",
  });
};
