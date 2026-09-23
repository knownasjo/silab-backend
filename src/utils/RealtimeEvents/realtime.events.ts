import { Response } from "express";
import db from "../../prisma/client.prisma";

export type RealtimeEventType =
  | "announcement"
  | "subject"
  | "class"
  | "activation"
  | "meeting"
  | "attendance";

export interface IRealtimeSubscriber {
  userId: string;
  isStaff: boolean;
}

interface IRealtimeConnection extends IRealtimeSubscriber {
  res: Response;
}

const HEARTBEAT_MS = 25_000;

const connections = new Set<IRealtimeConnection>();

const writeEvent = (res: Response, event: string, data: object = {}) => {
  if (res.writableEnded || res.destroyed) return;

  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const openRealtimeStream = (
  subscriber: IRealtimeSubscriber,
  res: Response,
  closeAt?: number
) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const connection: IRealtimeConnection = { ...subscriber, res };
  connections.add(connection);

  const heartbeat = setInterval(() => writeEvent(res, "ping"), HEARTBEAT_MS);
  const expiry = closeAt
    ? setTimeout(() => res.end(), Math.max(closeAt - Date.now(), 0))
    : undefined;

  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    connections.delete(connection);
  });

  writeEvent(res, "ready");
};

export const publishRealtimeEvent = (
  type: RealtimeEventType,
  data: Record<string, string> = {},
  studentIds?: string[]
) => {
  connections.forEach((connection) => {
    if (
      studentIds &&
      !connection.isStaff &&
      !studentIds.includes(connection.userId)
    )
      return;

    writeEvent(connection.res, type, data);
  });
};

export const publishClassMembersEvent = async (
  classId: string,
  type: RealtimeEventType,
  data: Record<string, string>
) => {
  try {
    const participants = await db.trn_class_participants.findMany({
      where: { classId, deleted_at: null },
      select: { userId: true },
    });

    publishRealtimeEvent(
      type,
      data,
      participants.map((participant) => participant.userId)
    );
  } catch {
    publishRealtimeEvent(type, data, []);
  }
};
