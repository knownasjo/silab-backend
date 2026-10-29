import { Prisma } from "@prisma/client";
import { NotFoundError } from "../HttpErrors/HttptErrors";

type AdapterConstraint = { index?: string; fields?: string[] };

const violatedConstraint = (error: Prisma.PrismaClientKnownRequestError) => {
  const constraint = (
    error.meta?.driverAdapterError as
      | { cause?: { constraint?: AdapterConstraint } }
      | undefined
  )?.cause?.constraint;

  return constraint?.index ?? constraint?.fields?.join(",") ?? "";
};

export const rethrowIfSubjectDeleted = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003" &&
    violatedConstraint(error).includes("subjectId")
  )
    throw new NotFoundError("Mata kuliah tidak ditemukan!");

  throw error;
};
