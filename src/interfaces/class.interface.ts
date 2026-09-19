export interface IAddClassRequestBody {
  subjectId: string;
  name: string;
  quota: number;
  day: string;
  startAt: string;
  endAt: string;
  room: string;
  created_by: string;
}

export interface IGetClassResponseBody {
  id: string;
  subjectId: string;
  name: string;
  subject_name: string;
  semester: string;
  quota: number;
  isFull: boolean;
  day: string;
  startAt: string;
  endAt: string;
  room: string;
  participants: number;
}

export interface IGetClassByIdResponseBody {
  id: string;
  subjectId: string;
  name: string;
  subject_name: string;
  semester: string;
  quota: number;
  isFull: boolean;
  day: string;
  startAt: string;
  endAt: string;
  room: string;
  lecturer: string;
  participants: number;
}

export interface IGetAllClassByPaidActivationsResponseBody {
  id: string;
  subject_name: string;
  subject_class: string;
  semester: string;
  session_time: string;
  quota: number;
  registered_students: number;
  day: string;
}

export interface IClassRegistrationRequestBody {
  classIds: string[];
}
