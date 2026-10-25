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
    select: { deviceId: true, isUsual: true },
  });

export const isUsualDevice = (
  devices: { deviceId: string; isUsual: boolean }[],
  deviceId: string
) => {
  const known = devices.find((device) => device.deviceId === deviceId);

  return known ? known.isUsual : !devices.some((device) => device.isUsual);
};

export const rememberDevice = async (
  userId: string,
  deviceId: string,
  client: Client = db
) => {
  const [device] = await client.$queryRaw<{ isUsual: boolean }[]>`
    INSERT INTO "trn_user_devices" ("id", "userId", "deviceId", "isUsual")
    VALUES (
      gen_random_uuid()::text,
      ${userId},
      ${deviceId},
      NOT EXISTS (
        SELECT 1 FROM "trn_user_devices"
        WHERE "userId" = ${userId} AND "isUsual"
      )
    )
    ON CONFLICT ("userId", "deviceId")
    DO UPDATE SET "lastSeenAt" = CURRENT_TIMESTAMP
    RETURNING "isUsual"`;

  return device.isUsual;
};

export const makeUsualDevice = async (
  userId: string,
  deviceId: string,
  client: Client = db
) => {
  await client.trn_user_devices.updateMany({
    where: { userId, isUsual: true, deviceId: { not: deviceId } },
    data: { isUsual: false },
  });

  await client.trn_user_devices.upsert({
    where: { userId_deviceId: { userId, deviceId } },
    update: { isUsual: true },
    create: { userId, deviceId, isUsual: true },
  });
};
