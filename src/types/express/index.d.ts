import { mst_user } from "@prisma/client";
import express from "express";

declare global {
  namespace Express {
    export interface Request {
      user?: mst_user;
    }
  }
}
