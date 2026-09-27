import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { BaseError } from "../utils/BaseErrors/BaseErrors";

const DATABASE_BUSY_CODES = ["P2024", "P2028"];

const BODY_ERROR_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Format JSON tidak valid!",
  "entity.too.large": "Isi permintaan terlalu besar!",
};

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

  const { type, status } = err as { type?: string; status?: number };

  if (type && BODY_ERROR_MESSAGES[type]) {
    res
      .status(status ?? 400)
      .json({ status: false, message: BODY_ERROR_MESSAGES[type] });
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
