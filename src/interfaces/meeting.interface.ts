import { DeviceCheck } from "@prisma/client";

export interface IAddClassMeetingRequestBody {
  classId: string;
  meetingName: string;
}

export interface IUpdateMeetingRequestBody {
  meetingName: string;
}

export interface IGetAllClassMeetingResponseBody {
  id: string;
  meetingName: string;
  isOpen: boolean;
  isHeld?: boolean;
  students?: IMeetingParticipants[];
  submittedAt?: string | null;
  isAttended?: boolean;
}

export interface IGetMeetingQrTokenResponseBody {
  token: string;
  periodSeconds: number;
  expiresInMs: number;
}

export interface IMeetingParticipants {
  studentId: string;
  studentName: string;
  nim: string;
  submittedAt: string | null;
  isAttended: boolean;
  deviceCheck: DeviceCheck | null;
}
