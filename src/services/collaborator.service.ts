import {
  IAddCollaboratorRequestBody,
  IGetCollaboratorsResponseBody,
} from "../interfaces/collaborator.interface";
import { IBaseResponse } from "../interfaces/global.interface";
import db from "../prisma/client.prisma";
import { NotFoundError } from "../utils/HttpErrors/HttptErrors";

export const SAddCollaborator = async (
  body: IAddCollaboratorRequestBody
): Promise<IBaseResponse> => {
  try {
    const { collaborators, classId } = body;

    const [isClassExist, isUserExist] = await Promise.all([
      db.mst_class.findUnique({
        where: {
          id: classId,
          deleted_at: null,
        },
      }),
      db.mst_user.findMany({
        where: {
          id: {
            in: collaborators,
          },
        },
      }),
    ]);

    if (!isClassExist) throw new NotFoundError("Class not found!");
    if (!isUserExist) throw new NotFoundError("User not found!");

    await db.trn_class_collaborator.createMany({
      data: collaborators.map((userId) => ({
        userId,
        classId,
      })),
      skipDuplicates: true,
    });

    return {
      status: true,
      message: "Collaborators added!",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetCollaborators = async (
  id: string
): Promise<IBaseResponse<IGetCollaboratorsResponseBody[]>> => {
  try {
    const collaboratorsData = await db.trn_class_collaborator.findMany({
      where: {
        classId: id,
      },
      include: {
        user: {
          select: {
            fullname: true,
          },
        },
      },
    });

    const data: IGetCollaboratorsResponseBody[] = collaboratorsData.map(
      (data) => ({
        fullname: data.user.fullname,
      })
    );

    return {
      status: true,
      message: "Sucess",
      data,
    };
  } catch (error) {
    throw error;
  }
};
