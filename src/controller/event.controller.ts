import { NextFunction, Request, Response } from "express";
import { SGetRealtimeSubscriber } from "../services/event.service";
import { openRealtimeStream } from "../utils/RealtimeEvents/realtime.events";

export const CStreamEvents = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const subscriber = SGetRealtimeSubscriber(req);

    openRealtimeStream(subscriber, res, req.tokenExpiresAt);
  } catch (error: any) {
    next(error);
  }
};
