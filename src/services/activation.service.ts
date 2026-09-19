import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import {
  IAddActivationRequestBody,
  IGetActivationResponseBody,
} from "../interfaces/activation.interface";
import { Prisma } from "@prisma/client";

export const SAddStudentActivation = async (
  body: IAddActivationRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const { subjectIds } = body;

    if (user?.role !== "MAHASISWA")
      throw new UnauthorizedError("User is not allowed!");

    const existingActivations = await db.trn_activations.findMany({
      where: {
        userId: user.id,
        subjectId: {
          in: subjectIds,
        },
      },
    });

    if (existingActivations.length > 0) {
      const alreadyActivatedIds = existingActivations.map((a) => a.subjectId);
      throw new ConflictError(
        `Already activated current subjects : ${alreadyActivatedIds.join(", ")}`
      );
    }

    await db.trn_activations.createMany({
      data: subjectIds.map((subjectId) => ({
        userId: user.id,
        subjectId,
      })),
      skipDuplicates: true,
    });

    return {
      status: true,
      message: "Activation added",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetAllActivations = async (
  req: Request
): Promise<IBaseResponse<IGetActivationResponseBody[]>> => {
  try {
    const user = req.user;
    const statusQuery = req.query.status;
    const nameQuery = req.query.name?.toString();

    const whereCondition = {
      deleted_at: null,
      ...(user?.role === "MAHASISWA" && {
        userId: user.id,
      }),
      ...(statusQuery ? { status: statusQuery === "true" } : {}),
      ...(nameQuery && {
        user: {
          fullname: {
            contains: nameQuery,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      }),
    };

    const activationsData = await db.trn_activations.findMany({
      where: whereCondition,
      include: {
        user: {
          select: {
            nim: true,
            fullname: true,
          },
        },
        subject: {
          select: {
            subject_name: true,
            semester: true,
          },
        },
      },
    });

    const data: IGetActivationResponseBody[] = activationsData.map((data) => ({
      id: data.id,
      nim: data.user.nim,
      student: data.user.fullname,
      status: data.status,
      subjects: [data.subject],
    }));

    return {
      status: true,
      message: "Success",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateActivationPaymentStatus = async (
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;
    const id = req.params.id.toString();

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed!");

    const isActivationExist = await db.trn_activations.findUnique({
      where: {
        id,
      },
    });

    if (!isActivationExist) throw new NotFoundError("Activation not found!");

    await db.trn_activations.update({
      where: {
        id,
      },
      data: {
        status: true,
      },
    });

    return {
      status: true,
      message: "Success",
    };
  } catch (error) {
    throw error;
  }
};
