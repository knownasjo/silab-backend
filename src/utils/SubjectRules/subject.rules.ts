import { Prisma } from "@prisma/client";
import { NotFoundError } from "../HttpErrors/HttptErrors";

export const rethrowIfSubjectDeleted = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003" &&
    String(error.meta?.constraint ?? error.meta?.field_name ?? "").includes(
      "subjectId"
    )
  )
    throw new NotFoundError("Mata kuliah tidak ditemukan!");

  throw error;
};
