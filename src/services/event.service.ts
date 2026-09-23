import { Request } from "express";
import { UnauthorizedError } from "../utils/HttpErrors/HttptErrors";
import { IRealtimeSubscriber } from "../utils/RealtimeEvents/realtime.events";

export const SGetRealtimeSubscriber = (req: Request): IRealtimeSubscriber => {
  const user = req.user;

  if (!user) throw new UnauthorizedError("Anda tidak memiliki akses!");

  return { userId: user.id, isStaff: user.role !== "MAHASISWA" };
};
