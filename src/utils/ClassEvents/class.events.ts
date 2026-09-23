import { Response } from "express";

export type ClassEventType = "meeting" | "attendance";

export interface IClassEventSubscriber {
  userId: string;
  isStaff: boolean;
}

interface IClassEventConnection extends IClassEventSubscriber {
  res: Response;
}

const HEARTBEAT_MS = 25_000;

const rooms = new Map<string, Set<IClassEventConnection>>();

const writeEvent = (res: Response, event: string, data: object = {}) => {
  if (res.writableEnded || res.destroyed) return;

  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const openClassEventStream = (
  classId: string,
  subscriber: IClassEventSubscriber,
  res: Response,
  closeAt?: number
) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const connection: IClassEventConnection = { ...subscriber, res };
  const room = rooms.get(classId) ?? new Set<IClassEventConnection>();
  room.add(connection);
  rooms.set(classId, room);

  const heartbeat = setInterval(() => writeEvent(res, "ping"), HEARTBEAT_MS);
  const expiry = closeAt
    ? setTimeout(() => res.end(), Math.max(closeAt - Date.now(), 0))
    : undefined;

  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    room.delete(connection);
    if (room.size === 0 && rooms.get(classId) === room) rooms.delete(classId);
  });

  writeEvent(res, "ready");
};

export const publishClassEvent = (
  classId: string,
  type: ClassEventType,
  meetingId: string,
  studentId?: string
) => {
  rooms.get(classId)?.forEach((connection) => {
    if (
      type === "attendance" &&
      !connection.isStaff &&
      connection.userId !== studentId
    )
      return;

    writeEvent(connection.res, type, { meeting_id: meetingId });
  });
};
