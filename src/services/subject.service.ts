import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddSubjectRequestBody,
  IGetAllSubjectsResponseBody,
  IUpdateSubjectRequestBody,
} from "../interfaces/subject.interface";
import db from "../prisma/client.prisma";
import { Prisma } from "@prisma/client";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/HttpErrors/HttptErrors";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  assertLecturerOfSubject,
  lecturerSubjectScope,
} from "../utils/ClassAccess/class.access";

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface ISubjectFields {
  subjectCode: string;
  subjectName: string;
  semester: string;
  lecturerId: string;
}

const readSubjectFields = async (
  source: IUpdateSubjectRequestBody
): Promise<ISubjectFields & { lecturerName: string }> => {
  const subjectCode = readText(source?.subjectCode);
  const subjectName = readText(source?.subjectName);
  const semester = readText(
    typeof source?.semester === "number"
      ? String(source.semester)
      : source?.semester
  );
  const lecturerId = readText(source?.lecturerId);

  if (!subjectCode)
    throw new BadRequestError("Kode mata kuliah wajib diisi!");

  if (!/^\d{9}$/.test(subjectCode))
    throw new BadRequestError("Kode mata kuliah harus 9 angka!");

  if (!subjectName)
    throw new BadRequestError("Nama mata kuliah wajib diisi!");

  if (subjectName.length > 100)
    throw new BadRequestError("Nama mata kuliah paling banyak 100 karakter!");

  if (!/^[1-8]$/.test(semester))
    throw new BadRequestError("Semester harus angka 1 sampai 8!");

  const lecturer = lecturerId
    ? await db.mst_user.findFirst({
        where: { id: lecturerId, role: "DOSEN" },
        select: { fullname: true },
      })
    : null;

  if (!lecturer)
    throw new BadRequestError(
      "Dosen pengampu harus akun dosen yang terdaftar!"
    );

  return {
    subjectCode,
    subjectName,
    semester,
    lecturerId,
    lecturerName: lecturer.fullname,
  };
};

const lockSubjects = (tx: Prisma.TransactionClient) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"subject:unique"}))`;

const assertSubjectUnique = async (
  tx: Prisma.TransactionClient,
  fields: { subjectCode?: string; subjectName?: string },
  exceptId?: string
) => {
  const others = await tx.mst_subject.findMany({
    where: {
      deletedAt: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { subjectCode: true, subjectName: true },
  });

  const sameCode = fields.subjectCode
    ? others.find((other) => sameText(other.subjectCode, fields.subjectCode!))
    : undefined;

  if (sameCode)
    throw new ConflictError(
      `Kode ${fields.subjectCode} sudah dipakai mata kuliah ${sameCode.subjectName}!`
    );

  const sameName = fields.subjectName
    ? others.find((other) => sameText(other.subjectName, fields.subjectName!))
    : undefined;

  if (sameName)
    throw new ConflictError(
      `Nama ${fields.subjectName} sudah dipakai mata kuliah berkode ${sameName.subjectCode}!`
    );
};

export const SAddSubject = async (
  body: IAddSubjectRequestBody,
  req: Request
): Promise<IBaseResponse<{ id: string }>> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat menambah mata kuliah!");

  const { lecturerName, ...fields } = await readSubjectFields(body);

  const subject = await db.$transaction(
    async (tx) => {
      await lockSubjects(tx);
      await assertSubjectUnique(tx, fields);

      return tx.mst_subject.create({
        data: { ...fields, createdBy: req.user!.id },
      });
    },
    { maxWait: 10000, timeout: 20000 }
  );

  publishRealtimeEvent("subject", {
    subjectId: subject.id,
    action: "created",
  });

  return {
    status: true,
    message: `Mata kuliah ${fields.subjectName} berhasil ditambahkan`,
    data: { id: subject.id },
  };
};

export const SGetSubject = async (
  req: Request
): Promise<IBaseResponse<IGetAllSubjectsResponseBody[]>> => {
  try {
    const subjects = await db.mst_subject.findMany({
      where: {
        deletedAt: null,
        ...lecturerSubjectScope(req.user),
      },
      include: {
        lecturer: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const data: IGetAllSubjectsResponseBody[] = subjects.map((subject) => ({
      id: subject.id,
      subjectCode: subject.subjectCode,
      subjectName: subject.subjectName,
      semester: subject.semester,
      lecturerId: subject.lecturerId,
      lecturer: subject.lecturer.fullname,
    }));

    return {
      status: true,
      message: "Berhasil",
      data: data,
    };
  } catch (error) {
    throw error;
  }
};

export const SGetSubjectById = async (
  id: string,
  req: Request
): Promise<IBaseResponse<IGetAllSubjectsResponseBody>> => {
  try {
    const subjectData = await db.mst_subject.findUnique({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        lecturer: true,
      },
    });

    if (!subjectData) throw new NotFoundError("Mata kuliah tidak ditemukan!");

    assertLecturerOfSubject(req.user, subjectData.lecturerId);

    return {
      status: true,
      message: "Berhasil",
      data: {
        id: subjectData.id,
        subjectCode: subjectData.subjectCode,
        subjectName: subjectData.subjectName,
        semester: subjectData.semester,
        lecturerId: subjectData.lecturerId,
        lecturer: subjectData.lecturer.fullname,
      },
    };
  } catch (error) {
    throw error;
  }
};

export const SUpdateSubject = async (
  id: string,
  body: IUpdateSubjectRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat mengubah mata kuliah!");

  const current = await db.mst_subject.findFirst({
    where: { id, deletedAt: null },
  });

  if (!current) throw new NotFoundError("Mata kuliah tidak ditemukan!");

  const { lecturerName, ...fields } = await readSubjectFields({
    subjectCode: body?.subjectCode ?? current.subjectCode,
    subjectName: body?.subjectName ?? current.subjectName,
    semester: body?.semester ?? current.semester,
    lecturerId: body?.lecturerId ?? current.lecturerId,
  });
  const { subjectCode, subjectName, semester, lecturerId } = fields;

  const isCodeChanged = subjectCode !== current.subjectCode;
  const isNameChanged = subjectName !== current.subjectName;
  const isLecturerChanged = lecturerId !== current.lecturerId;

  if (
    !isCodeChanged &&
    !isNameChanged &&
    !isLecturerChanged &&
    semester === current.semester
  )
    return { status: true, message: "Tidak ada perubahan pada mata kuliah" };

  await db.$transaction(
    async (tx) => {
      await lockSubjects(tx);
      await assertSubjectUnique(
        tx,
        {
          subjectCode: isCodeChanged ? subjectCode : undefined,
          subjectName: isNameChanged ? subjectName : undefined,
        },
        id
      );

      await tx.mst_subject.update({
        where: { id },
        data: {
          subjectCode,
          subjectName,
          semester,
          lecturerId,
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        },
      });
    },
    { maxWait: 10000, timeout: 20000 }
  );

  const [classes, activations] = await Promise.all([
    db.mst_class.findMany({
      where: { subjectId: id, deletedAt: null },
      select: { id: true },
    }),
    db.trn_activations.findMany({
      where: { subjectId: id, deletedAt: null },
      select: { userId: true },
    }),
  ]);

  publishRealtimeEvent("subject", { subjectId: id, action: "updated" });
  classes.forEach((subjectClass) =>
    publishRealtimeEvent("class", { classId: subjectClass.id })
  );
  if (activations.length > 0)
    publishRealtimeEvent(
      "activation",
      { subjectId: id },
      activations.map((activation) => activation.userId)
    );

  return {
    status: true,
    message: isLecturerChanged
      ? `Mata kuliah ${subjectName} berhasil diperbarui; dosen pengampu sekarang ${lecturerName}`
      : `Mata kuliah ${subjectName} berhasil diperbarui`,
  };
};

export const SDeleteSubject = async (
  id: string,
  req: Request
): Promise<IBaseResponse> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat menghapus mata kuliah!");

  const subject = await db.mst_subject.findFirst({
    where: { id, deletedAt: null },
  });

  if (!subject) throw new NotFoundError("Mata kuliah tidak ditemukan!");

  const usedMessage = async () => {
    const [classes, activations, announcements] = await Promise.all([
      db.mst_class.count({ where: { subjectId: id } }),
      db.trn_activations.count({ where: { subjectId: id } }),
      db.trn_announcement_subjects.count({
        where: { subjectId: id, announcement: { deletedAt: null } },
      }),
    ]);
    const parts = [
      classes > 0 && `${classes} kelas`,
      activations > 0 && `${activations} pendaftaran`,
      announcements > 0 && `${announcements} pengumuman`,
    ].filter((part): part is string => Boolean(part));
    const used =
      parts.length > 2
        ? `${parts.slice(0, -1).join(", ")}, dan ${parts[parts.length - 1]}`
        : parts.join(" dan ");

    return used
      ? `${subject.subjectName} sudah punya ${used}, jadi tidak bisa dihapus.`
      : null;
  };

  const blocker = await usedMessage();

  if (blocker) throw new ConflictError(blocker);

  try {
    await db.mst_subject.delete({ where: { id } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      throw new ConflictError(
        (await usedMessage()) ??
          `${subject.subjectName} baru saja dipakai, jadi tidak bisa dihapus.`
      );

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundError("Mata kuliah tidak ditemukan!");

    throw error;
  }

  publishRealtimeEvent("subject", { subjectId: id, action: "deleted" });

  return {
    status: true,
    message: `Mata kuliah ${subject.subjectName} berhasil dihapus`,
  };
};
