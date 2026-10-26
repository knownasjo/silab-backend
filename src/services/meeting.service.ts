import { DeviceCheck, Prisma } from "@prisma/client";
import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddClassMeetingRequestBody,
  IGetAllClassMeetingResponseBody,
  IGetMeetingQrTokenResponseBody,
  IUpdateMeetingRequestBody,
} from "../interfaces/meeting.interface";
import db from "../prisma/client.prisma";
import { generateToken } from "../utils/GenerateMeetingToken/generate.token";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { isMeetingHeld } from "../utils/MeetingRules/meeting.rules";
import { getCurrentQrToken } from "../utils/QrToken/qr.token";
import { publishClassMembersEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  assertCanManageClass,
  assertLecturerOfClass,
  isClassAssistant,
} from "../utils/ClassAccess/class.access";

const MEETING_NAME_MAX = 50;

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const sameText = (a: string, b: string) =>
  readText(a).toLowerCase() === readText(b).toLowerCase();

const meetingNameOrder = new Intl.Collator("id", {
  numeric: true,
  sensitivity: "base",
});

const readMeetingName = (value: unknown) => {
  const text = readText(value);
  const name = text.charAt(0).toUpperCase() + text.slice(1);

  if (!name) throw new BadRequestError("Judul pertemuan wajib diisi!");

  if (name.length > MEETING_NAME_MAX)
    throw new BadRequestError(
      `Judul pertemuan paling banyak ${MEETING_NAME_MAX} karakter!`
    );

  return name;
};

const saveMeetingName = <T>(
  classId: string,
  name: string,
  exceptId: string | null,
  save: (tx: Prisma.TransactionClient) => Promise<T>
) =>
  db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${classId}))`;

    const meetings = await tx.trn_meetings.findMany({
      where: {
        classId,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });

    const twin = meetings.find((other) => sameText(other.name, name));

    if (twin) throw new ConflictError(`${twin.name} sudah ada di kelas ini!`);

    return save(tx);
  });

const findManagedMeeting = async (meetingId: string, req: Request) => {
  const meeting = await db.trn_meetings.findFirst({
    where: { id: meetingId, deletedAt: null },
    include: { _count: { select: { participants: true } } },
  });

  if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

  await assertCanManageClass(req.user, meeting.classId);

  return meeting;
};

export const SAddClassMeeting = async (
  body: IAddClassMeetingRequestBody,
  req: Request
): Promise<IBaseResponse<{ id: string }>> => {
  const user = req.user;
  const classId = body?.classId;

  if (typeof classId !== "string" || !classId.trim())
    throw new BadRequestError("Kelas wajib diisi!");

  const isClassExist = await db.mst_class.findUnique({
    where: {
      id: classId,
    },
  });

  if (!isClassExist) throw new NotFoundError("Kelas tidak ditemukan!");

  await assertCanManageClass(user, isClassExist.id);

  const meetingName = readMeetingName(body?.meetingName);

  const meeting = await saveMeetingName(
    isClassExist.id,
    meetingName,
    null,
    (tx) =>
      tx.trn_meetings.create({
        data: {
          classId: isClassExist.id,
          name: meetingName,
          token: generateToken(),
        },
      })
  );

  void publishClassMembersEvent(meeting.classId, "meeting", {
    classId: meeting.classId,
    meetingId: meeting.id,
    action: "created",
  });

  return {
    status: true,
    message: `${meeting.name} berhasil ditambahkan`,
    data: { id: meeting.id },
  };
};

export const SUpdateMeeting = async (
  meetingId: string,
  body: IUpdateMeetingRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  const meeting = await findManagedMeeting(meetingId, req);
  const meetingName = readMeetingName(body?.meetingName);

  if (meetingName === meeting.name)
    return { status: true, message: "Tidak ada perubahan pada pertemuan" };

  await saveMeetingName(meeting.classId, meetingName, meeting.id, (tx) =>
    tx.trn_meetings.update({
      where: { id: meeting.id },
      data: { name: meetingName, updatedAt: new Date() },
    })
  );

  void publishClassMembersEvent(meeting.classId, "meeting", {
    classId: meeting.classId,
    meetingId: meeting.id,
    action: "updated",
  });

  return {
    status: true,
    message: `${meeting.name} berhasil diubah menjadi ${meetingName}`,
  };
};

export const SDeleteMeeting = async (
  meetingId: string,
  req: Request
): Promise<IBaseResponse> => {
  const meeting = await findManagedMeeting(meetingId, req);

  const assertDeletable = (current: typeof meeting) => {
    if (current.status)
      throw new ConflictError(
        "Sesi presensi pertemuan ini sedang dibuka. Tutup sesinya dulu sebelum menghapus."
      );

    if (current._count.participants > 0)
      throw new ConflictError(
        `Pertemuan ini sudah punya ${current._count.participants} presensi, jadi tidak bisa dihapus. Hapus presensinya dulu atau ubah judulnya.`
      );
  };

  assertDeletable(meeting);

  try {
    const { count } = await db.trn_meetings.deleteMany({
      where: { id: meeting.id, status: false },
    });

    if (count === 0) {
      assertDeletable(await findManagedMeeting(meetingId, req));
      throw new ConflictError("Pertemuan ini baru saja berubah, coba lagi.");
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      throw new ConflictError(
        "Presensi baru saja tercatat di pertemuan ini, jadi tidak bisa dihapus."
      );

    throw error;
  }

  void publishClassMembersEvent(meeting.classId, "meeting", {
    classId: meeting.classId,
    meetingId: meeting.id,
    action: "deleted",
  });

  return {
    status: true,
    message: `${meeting.name} berhasil dihapus`,
  };
};

export const SGetAllClassMeeting = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IGetAllClassMeetingResponseBody[]>> => {
  try {
    const user = req.user;

    const isClassExist = await db.mst_class.findUnique({
      where: {
        id,
      },
    });

    if (!isClassExist) throw new NotFoundError("Kelas tidak ditemukan!");

    await assertLecturerOfClass(user, isClassExist.id);

    let isStudent = false;

    if (user?.role === "MAHASISWA") {
      const isClassParticipant = await db.trn_class_participants.findFirst({
        where: { classId: isClassExist.id, userId: user.id, deletedAt: null },
      });

      isStudent = Boolean(isClassParticipant);

      if (!isStudent && !(await isClassAssistant(user.id, isClassExist.id)))
        throw new ForbiddenError("Anda tidak terdaftar di kelas ini!");
    }

    const meetingsData = await db.trn_meetings.findMany({
      where: {
        classId: isClassExist.id,
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        participants: {
          select: {
            userId: true,
            createdAt: true,
            status: true,
            deviceCheck: true,
            user: {
              select: {
                id: true,
                nim: true,
                fullname: true,
              },
            },
          },
        },
      },
    });

    const classParticipants = isStudent
      ? []
      : await db.trn_class_participants.findMany({
          where: {
            classId: isClassExist.id,
            deletedAt: null,
          },
          orderBy: { user: { nim: "asc" } },
          include: {
            user: {
              select: {
                id: true,
                nim: true,
                fullname: true,
              },
            },
          },
        });

    meetingsData.sort((a, b) =>
      meetingNameOrder.compare(readText(a.name), readText(b.name))
    );

    const data: IGetAllClassMeetingResponseBody[] = meetingsData.map(
      (meeting) => {
        if (isStudent) {
          const ownRecord = meeting.participants.find(
            (p) => p.userId === user?.id
          );

          return {
            id: meeting.id,
            meetingName: meeting.name,
            isOpen: meeting.status,
            submittedAt: ownRecord?.createdAt.toISOString() ?? null,
            isAttended: ownRecord?.status ?? false,
          };
        }

        const studentsInClass = classParticipants.map((participant) => ({
          studentId: participant.user.id,
          studentName: participant.user.fullname,
          nim: participant.user.nim,
          submittedAt: null as string | null,
          isAttended: false,
          deviceCheck: null as DeviceCheck | null,
        }));

        meeting.participants.forEach((meetingParticipant) => {
          const student = studentsInClass.find(
            (s) => s.studentId === meetingParticipant.user.id
          );
          if (student) {
            student.isAttended = meetingParticipant.status;
            student.submittedAt = meetingParticipant.createdAt.toISOString();
            student.deviceCheck = meetingParticipant.deviceCheck;
          }
        });

        return {
          id: meeting.id,
          meetingName: meeting.name,
          isOpen: meeting.status,
          isHeld: isMeetingHeld(meeting.status, meeting.participants.length),
          students: studentsInClass,
        };
      }
    );

    return {
      status: true,
      message: "Berhasil",
      data,
    };
  } catch (error) {
    throw error;
  }
};

export const SGetMeetingQrToken = async (
  meetingId: string,
  req: Request
): Promise<IBaseResponse<IGetMeetingQrTokenResponseBody>> => {
  try {
    const user = req.user;

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deletedAt: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    await assertCanManageClass(user, meeting.classId);

    if (!meeting.status)
      throw new ForbiddenError("Sesi presensi belum dibuka!");

    const { token, periodSeconds, expiresInMs } = getCurrentQrToken(
      meeting.id
    );

    return {
      status: true,
      message: "Berhasil",
      data: {
        token,
        periodSeconds,
        expiresInMs,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateMeetingStatus = async (
  meetingId: string,
  status: boolean,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const user = req.user;

    const meeting = await db.trn_meetings.findFirst({
      where: {
        id: meetingId,
        deletedAt: null,
      },
    });

    if (!meeting) throw new NotFoundError("Pertemuan tidak ditemukan!");

    await assertCanManageClass(user, meeting.classId);

    await db.trn_meetings.update({
      where: {
        id: meetingId,
      },
      data: {
        status: status,
        updatedAt: new Date(),
      },
    });

    void publishClassMembersEvent(meeting.classId, "meeting", {
      classId: meeting.classId,
      meetingId: meeting.id,
    });

    return {
      status: true,
      message: status
        ? "Sesi presensi dibuka"
        : "Sesi presensi ditutup",
    };
  } catch (error) {
    throw error;
  }
};
