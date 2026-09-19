export interface IAddActivationRequestBody {
  subjectIds: string[];
}

export interface IGetActivationResponseBody {
  id: string;
  nim: string;
  student: string;
  status: boolean;
  subjects: IStudentActivationPaymentStatus[];
}

export interface IStudentActivationPaymentStatus {
  subject_name: string;
  semester: string;
}
