import { Request } from "express";
import { UnauthorizedError } from "../utils/HttpErrors/HttptErrors";
import { IBaseResponse } from "../interfaces/global.interface";
import { IGetUserResponseBody } from "../interfaces/user.interface";
import db from "../prisma/client.prisma";
import { UserRole } from "@prisma/client";

export const SGetUser = async (
  req: Request,
  query: string | undefined
): Promise<IBaseResponse<IGetUserResponseBody[]>> => {
  try {
    const user = req.user;
    const role = req.path;

    if (user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed!");

    const userData = await db.mst_user.findMany({
      where: {
        fullname: {
          contains: query,
        },
        role: role.split("/").join("").toUpperCase() as UserRole,
      },
    });

    const data: IGetUserResponseBody[] = userData.map((data) => ({
      id: data.id,
      nim: data.nim,
      fullname: data.fullname,
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
