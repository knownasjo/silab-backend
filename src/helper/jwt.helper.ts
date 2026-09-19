import jwt from "jsonwebtoken";
import db from "../prisma/client.prisma";
import { IJWTPayload } from "../interfaces/jwt.interface";
import { env } from "../config/env.config";
import { IJWTUserPayload } from "../interfaces/auth.interface";

export const CreateToken = (payload: IJWTPayload) =>
  jwt.sign(payload, env.JWT.SECRET, {
    expiresIn: "15m",
    algorithm: "HS256",
  });

export const CreateRefreshToken = (payload: IJWTPayload) =>
  jwt.sign(payload, env.JWT.REFRESH_SECRET, {
    expiresIn: "1d",
    algorithm: "HS256",
  });

export const VerifyToken = async (token: string): Promise<IJWTUserPayload> => {
  try {
    const tokenData: IJWTPayload = jwt.verify(
      token,
      env.JWT.SECRET
    ) as IJWTPayload;

    if (!tokenData.id || !tokenData) {
      throw Error("Failed to verify token!");
    }

    const user = await db.mst_user.findUnique({
      where: {
        id: tokenData.id,
      },
    });

    if (!user) throw Error("User not found!");

    return {
      id: user?.id,
      fullname: user?.fullname,
      nim: user?.nim,
      role: user?.role,
    };
  } catch (error: any) {
    throw Error(error);
  }
};
