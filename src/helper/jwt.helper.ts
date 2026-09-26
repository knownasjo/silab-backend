import jwt, { JwtPayload } from "jsonwebtoken";
import { IJWTPayload } from "../interfaces/jwt.interface";
import { env } from "../config/env.config";

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

export const VerifyRefreshToken = (
  token: string
): { id: string; issuedAt?: number } | null => {
  try {
    const { id, iat } = jwt.verify(token, env.JWT.REFRESH_SECRET, {
      algorithms: ["HS256"],
    }) as IJWTPayload & JwtPayload;

    return typeof id === "string" ? { id, issuedAt: iat } : null;
  } catch {
    return null;
  }
};

export const passwordChangeTime = () =>
  new Date(Math.floor(Date.now() / 1000) * 1000);

export const isIssuedBeforePasswordChange = (
  issuedAt: number | undefined,
  passwordChangedAt: Date | null
) =>
  !!passwordChangedAt && (issuedAt ?? 0) * 1000 < passwordChangedAt.getTime();
