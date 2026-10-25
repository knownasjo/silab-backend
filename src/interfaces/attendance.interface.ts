export interface IAddAttendanceRequestBody {
  token: string;
  deviceId?: string;
}

export interface IAddAttendanceResponseBody {
  meetingId: string;
  meetingName: string;
  studentName: string;
  nim: string;
  submittedAt: Date;
}

export interface IUpdateAttendanceRequestBody {
  status: boolean;
}

export interface ICheckAttendanceDeviceRequestBody {
  present: boolean;
}

export interface IUpdateAttendanceResponseBody {
  meetingId: string;
  meetingName: string;
  studentId: string;
  studentName: string;
  nim: string;
  isAttended: boolean;
  submittedAt: Date;
}
