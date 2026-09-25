import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddSubjectRequestBody,
  IGetAllSubjectsResponseBody,
  IUpdateSubjectRequestBody,
} from "../interfaces/subject.interface";
import db from "../prisma/client.prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";
import { publishRealtimeEvent } from "../utils/RealtimeEvents/realtime.events";
import {
  assertLecturerOfSubject,
  lecturerSubjectScope,
} from "../utils/ClassAccess/class.access";

export const SAddSubject = async (
  body: IAddSubjectRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  try {
    const { lecturer_id, semester, subject_code, subject_name } = body;

    const isSubjectExist = await db.mst_subject.findFirst({
      where: {
        subject_code: subject_code,
      },
    });

    if (req.user?.role !== "LABORAN")
      throw new UnauthorizedError("User not allowed to add subject");

    if (isSubjectExist) throw new ConflictError("Subject already exist");

    const subject = await db.mst_subject.create({
      data: {
        semester,
        subject_code,
        subject_name,
        lecturer_id,
        created_by: req.user?.id!,
      },
    });

    publishRealtimeEvent("subject", { subject_id: subject.id });

    return {
      status: true,
      message: "Subject added",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetSubject = async (
  req: Request
): Promise<IBaseResponse<IGetAllSubjectsResponseBody[]>> => {
  try {
    const subjects = await db.mst_subject.findMany({
      where: {
        deleted_at: null,
        ...lecturerSubjectScope(req.user),
      },
      include: {
        lecturer: true,
      },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });

    const data: IGetAllSubjectsResponseBody[] = subjects.map((subject) => ({
      id: subject.id,
      subject_code: subject.subject_code,
      subject_name: subject.subject_name,
      semester: subject.semester,
      lecturer_id: subject.lecturer_id,
      lecturer: subject.lecturer.fullname,
    }));

    return {
      status: true,
      message: "Success",
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
        deleted_at: null,
      },
      include: {
        lecturer: true,
      },
    });

    if (!subjectData) throw new NotFoundError("Subject not found!");

    assertLecturerOfSubject(req.user, subjectData.lecturer_id);

    return {
      status: true,
      message: "Success",
      data: {
        id: subjectData.id,
        subject_code: subjectData.subject_code,
        subject_name: subjectData.subject_name,
        semester: subjectData.semester,
        lecturer_id: subjectData.lecturer_id,
        lecturer: subjectData.lecturer.fullname,
      },
    };
  } catch (error) {
    throw error;
  }
};

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const SUpdateSubject = async (
  id: string,
  body: IUpdateSubjectRequestBody,
  req: Request
): Promise<IBaseResponse> => {
  if (req.user?.role !== "LABORAN")
    throw new ForbiddenError("Hanya laboran yang dapat mengubah mata kuliah!");

  const current = await db.mst_subject.findFirst({
    where: { id, deleted_at: null },
  });

  if (!current) throw new NotFoundError("Mata kuliah tidak ditemukan!");

  const subject_code = readText(body?.subject_code ?? current.subject_code);
  const subject_name = readText(body?.subject_name ?? current.subject_name);
  const semester = readText(String(body?.semester ?? current.semester));
  const lecturer_id = readText(body?.lecturer_id ?? current.lecturer_id);

  if (!subject_code)
    throw new BadRequestError("Kode mata kuliah wajib diisi!");

  if (subject_code.length > 20)
    throw new BadRequestError("Kode mata kuliah paling banyak 20 karakter!");

  if (!subject_name)
    throw new BadRequestError("Nama mata kuliah wajib diisi!");

  if (subject_name.length > 100)
    throw new BadRequestError("Nama mata kuliah paling banyak 100 karakter!");

  if (!/^[1-8]$/.test(semester))
    throw new BadRequestError("Semester harus angka 1 sampai 8!");

  const lecturer = lecturer_id
    ? await db.mst_user.findFirst({
        where: { id: lecturer_id, role: "DOSEN" },
        select: { fullname: true },
      })
    : null;

  if (!lecturer)
    throw new BadRequestError(
      "Dosen pengampu harus akun dosen yang terdaftar!"
    );

  const isCodeChanged = subject_code !== current.subject_code;
  const isNameChanged = subject_name !== current.subject_name;
  const isLecturerChanged = lecturer_id !== current.lecturer_id;

  if (
    !isCodeChanged &&
    !isNameChanged &&
    !isLecturerChanged &&
    semester === current.semester
  )
    return { status: true, message: "Tidak ada perubahan pada mata kuliah" };

  const others = await db.mst_subject.findMany({
    where: { id: { not: id }, deleted_at: null },
    select: { subject_code: true, subject_name: true },
  });

  const sameCode = isCodeChanged
    ? others.find((other) => sameText(other.subject_code, subject_code))
    : undefined;

  if (sameCode)
    throw new ConflictError(
      `Kode ${subject_code} sudah dipakai mata kuliah ${sameCode.subject_name}!`
    );

  const sameName = isNameChanged
    ? others.find((other) => sameText(other.subject_name, subject_name))
    : undefined;

  if (sameName)
    throw new ConflictError(
      `Nama ${subject_name} sudah dipakai mata kuliah berkode ${sameName.subject_code}!`
    );

  await db.mst_subject.update({
    where: { id },
    data: {
      subject_code,
      subject_name,
      semester,
      lecturer_id,
      updated_by: req.user.id,
      updated_at: new Date(),
    },
  });

  const [classes, activations] = await Promise.all([
    db.mst_class.findMany({
      where: { subjectId: id, deleted_at: null },
      select: { id: true },
    }),
    db.trn_activations.findMany({
      where: { subjectId: id, deleted_at: null },
      select: { userId: true },
    }),
  ]);

  publishRealtimeEvent("subject", { subject_id: id, action: "updated" });
  classes.forEach((subjectClass) =>
    publishRealtimeEvent("class", { class_id: subjectClass.id })
  );
  if (activations.length > 0)
    publishRealtimeEvent(
      "activation",
      { subject_id: id },
      activations.map((activation) => activation.userId)
    );

  return {
    status: true,
    message: isLecturerChanged
      ? `Mata kuliah ${subject_name} berhasil diperbarui; dosen pengampu sekarang ${lecturer.fullname}`
      : `Mata kuliah ${subject_name} berhasil diperbarui`,
  };
};
