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
  subjectName: string;
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
  subjectCode: string;
  subjectName: string;
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
  recordedMeetings: number;
  period: { id: string; name: string; isActive: boolean } | null;
}

export interface IGetAllClassByPaidActivationsResponseBody {
  id: string;
  subjectName: string;
  subjectClass: string;
  semester: string;
  sessionTime: string;
  quota: number;
  registeredStudents: number;
  day: string;
}

export interface IClassRegistrationRequestBody {
  classIds: string[];
}

export interface IGetClassmateResponseBody {
  name: string;
  isMe: boolean;
}

export interface IGetMyClassResponseBody {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectClass: string;
  semester: string;
  lecturer: string;
  day: string;
  sessionTime: string;
  room: string;
}
