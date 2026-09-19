import { Request } from "express";
import { IBaseResponse } from "../interfaces/global.interface";
import {
  IAddSubjectRequestBody,
  IGetAllSubjectsResponseBody,
} from "../interfaces/subject.interface";
import db from "../prisma/client.prisma";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../utils/HttpErrors/HttptErrors";

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

    await db.mst_subject.create({
      data: {
        semester,
        subject_code,
        subject_name,
        lecturer_id,
        created_by: req.user?.id!,
      },
    });

    return {
      status: true,
      message: "Subject added",
    };
  } catch (error) {
    throw error;
  }
};

export const SGetSubject = async (): Promise<
  IBaseResponse<IGetAllSubjectsResponseBody[]>
> => {
  try {
    const subjects = await db.mst_subject.findMany({
      where: {
        deleted_at: null,
      },
      include: {
        lecturer: true,
      },
    });

    const data: IGetAllSubjectsResponseBody[] = subjects.map((subject) => ({
      id: subject.id,
      subject_code: subject.subject_code,
      subject_name: subject.subject_name,
      semester: subject.semester,
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
  id: string
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

    return {
      status: true,
      message: "Success",
      data: {
        id: subjectData.id,
        subject_code: subjectData.subject_code,
        subject_name: subjectData.subject_name,
        semester: subjectData.semester,
        lecturer: subjectData.lecturer.fullname,
      },
    };
  } catch (error) {
    throw error;
  }
};
