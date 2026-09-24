import { NextFunction, Request, Response } from "express";
import { IJWTUserPayload } from "../interfaces/auth.interface";
import { env } from "../config/env.config";
import jwt, { JwtPayload } from "jsonwebtoken";
import db from "../prisma/client.prisma";
import { isIssuedBeforePasswordChange } from "../helper/jwt.helper";

const EXPIRED_TOKEN_MESSAGE = "jwt expired";

export const MAuthUser = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authorization } = req.headers;

      if (!authorization) throw Error("Unauthorize!");

      const userData = jwt.verify(
        authorization.split(" ")[1],
        env.JWT.SECRET
      ) as IJWTUserPayload & JwtPayload;

      if (!userData) throw Error("Unauthorize!");

      const user = await db.mst_user.findUnique({
        where: { id: userData.id },
      });

      if (
        !user ||
        isIssuedBeforePasswordChange(userData.iat, user.password_changed_at)
      )
        throw Error(EXPIRED_TOKEN_MESSAGE);

      req.user = user;
      req.tokenExpiresAt = userData.exp ? userData.exp * 1000 : undefined;
      next();
    } catch (error: any) {
      res.status(400).json({
        status: false,
        message: error.message || "Middleware error!",
      });
    }
  };
};
