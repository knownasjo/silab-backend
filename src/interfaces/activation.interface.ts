export interface IAddActivationRequestBody {
  subjectIds: string[];
}

export interface IUpdateActivationRequestBody {
  classId?: string;
  status?: boolean;
}

export interface IGetActivationResponseBody {
  id: string;
  user_id: string;
  nim: string;
  student: string;
  status: boolean;
  created_at: string;
  subject_id: string;
  subjects: IStudentActivationPaymentStatus[];
  registered_class: IRegisteredClass | null;
  available_classes: IAvailableClass[];
}

export interface IStudentActivationPaymentStatus {
  subject_name: string;
  semester: string;
}

export interface IRegisteredClass {
  id: string;
  name: string;
}

export interface IAvailableClass {
  id: string;
  name: string;
  day: string;
  session_time: string;
  room: string;
  quota: number;
  registered_students: number;
  is_full: boolean;
}
