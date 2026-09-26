export interface IAddClassRequestBody {
  subjectId?: string;
  name?: string;
  quota?: number;
  day?: string;
  room?: string;
  sessionId?: string;
}

export type IUpdateClassRequestBody = IAddClassRequestBody;

export interface IDeleteClassResponseBody {
  participants: number;
  assistants: number;
  meetings: number;
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
  sessionId: string | null;
  participants: number;
}

export interface IGetClassByIdResponseBody {
  id: string;
  subjectId: string;
  name: string;
  subject_code: string;
  subject_name: string;
  semester: string;
  quota: number;
  isFull: boolean;
  day: string;
  startAt: string;
  endAt: string;
  room: string;
  sessionId: string | null;
  lecturer: string;
  participants: number;
  meetings: number;
  recorded_meetings: number;
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

export interface IGetClassmateResponseBody {
  name: string;
  is_me: boolean;
}

export interface IGetMyClassResponseBody {
  id: string;
  subject_id: string;
  subject_name: string;
  subject_class: string;
  semester: string;
  lecturer: string;
  day: string;
  session_time: string;
  room: string;
}
