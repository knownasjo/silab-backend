export interface IAddSubjectRequestBody {
  subjectCode: string;
  subjectName: string;
  semester: string;
  lecturerId: string;
}

export interface IUpdateSubjectRequestBody {
  subjectCode?: string;
  subjectName?: string;
  semester?: string | number;
  lecturerId?: string;
}

export interface IGetAllSubjectsResponseBody {
  id: string;
  subjectCode: string;
  subjectName: string;
  semester: string;
  lecturerId: string;
  lecturer: string;
}

export interface IGetAllSubjectsBySemesterResponseBody {
  id: string;
  subjectCode: string;
  subjectName: string;
}
