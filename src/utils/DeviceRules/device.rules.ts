import { Prisma } from "@prisma/client";
import db from "../../prisma/client.prisma";
import { BadRequestError } from "../HttpErrors/HttptErrors";

type Client = Prisma.TransactionClient;

export const DEVICE_USED =
  "HP ini sudah dipakai presensi akun lain di pertemuan ini.";

const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/;

export const readDeviceId = (value: unknown) => {
  if (typeof value !== "string") return null;

  const deviceId = value.trim().toLowerCase();

  return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : null;
};

export const requireDeviceId = (value: unknown) => {
  const deviceId = readDeviceId(value);

  if (!deviceId)
    throw new BadRequestError(
      "Perbarui aplikasi SILAB ke versi terbaru untuk melakukan presensi."
    );

  return deviceId;
};

export const loadDevices = (userId: string, client: Client = db) =>
  client.trn_user_devices.findMany({
    where: { userId },
    select: { device_id: true, is_usual: true },
  });

export const isUsualDevice = (
  devices: { device_id: string; is_usual: boolean }[],
  deviceId: string
) => {
  const known = devices.find((device) => device.device_id === deviceId);

  return known ? known.is_usual : !devices.some((device) => device.is_usual);
};

export const rememberDevice = async (
  userId: string,
  deviceId: string,
  client: Client = db
) => {
  const [device] = await client.$queryRaw<{ is_usual: boolean }[]>`
    INSERT INTO "trn_user_devices" ("id", "userId", "device_id", "is_usual")
    VALUES (
      gen_random_uuid()::text,
      ${userId},
      ${deviceId},
      NOT EXISTS (
        SELECT 1 FROM "trn_user_devices"
        WHERE "userId" = ${userId} AND "is_usual"
      )
    )
    ON CONFLICT ("userId", "device_id")
    DO UPDATE SET "last_seen_at" = CURRENT_TIMESTAMP
    RETURNING "is_usual"`;

  return device.is_usual;
};
