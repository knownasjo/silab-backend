export interface IAddClassMeetingRequestBody {
  classId: string;
  meetingName: string;
}

export interface IGetAllClassMeetingResponseBody {
  id: string;
  meeting_name: string;
  token?: string;
  students?: IMeetingParticipants[];
}

export interface IMeetingParticipants {
  student_id: string;
  student_name: string;
  nim: string;
  submitted_at: string | null;
  is_attended: boolean;
}
