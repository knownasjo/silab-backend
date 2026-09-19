export interface IAddSubjectRequestBody {
  subject_code: string;
  subject_name: string;
  semester: string;
  lecturer_id: string;
}

export interface IGetAllSubjectsResponseBody {
  id: string;
  subject_code: string;
  subject_name: string;
  semester: string;
  lecturer: string;
}

export interface IGetAllSubjectsBySemesterResponseBody {
  id: string;
  subject_code: string;
  subject_name: string;
}
