import { NextFunction, Request, Response } from "express";
import { IJWTUserPayload } from "../interfaces/auth.interface";
import { env } from "../config/env.config";
import jwt from "jsonwebtoken";
import db from "../prisma/client.prisma";

export const MAuthUser = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authorization } = req.headers;

      if (!authorization) throw Error("Unauthorize!");

      const userData = jwt.verify(
        authorization.split(" ")[1],
        env.JWT.SECRET
      ) as IJWTUserPayload;

      if (!userData) throw Error("Unauthorize!");

      const user = await db.mst_user.findUnique({
        where: { id: userData.id },
      });

      if (!user) throw Error("User not found in middleware!");

      req.user = user;
      next();
    } catch (error: any) {
      res.status(400).json({
        status: false,
        message: error.message || "Middleware error!",
      });
    }
  };
};
