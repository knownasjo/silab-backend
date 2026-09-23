export interface IAddClassMeetingRequestBody {
  classId: string;
  meetingName: string;
}

export interface IGetAllClassMeetingResponseBody {
  id: string;
  meeting_name: string;
  is_open: boolean;
  /** Hanya untuk laboran/asisten/dosen. */
  students?: IMeetingParticipants[];
  /** Hanya untuk mahasiswa: status presensinya sendiri. */
  submitted_at?: string | null;
  is_attended?: boolean;
}

export interface IGetMeetingQrTokenResponseBody {
  token: string;
  period_seconds: number;
  expires_in_ms: number;
}

export interface IMeetingParticipants {
  student_id: string;
  student_name: string;
  nim: string;
  submitted_at: string | null;
  is_attended: boolean;
}
