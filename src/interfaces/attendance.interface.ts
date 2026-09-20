export interface IAddAttendanceRequestBody {
  token: string;
}

export interface IAddAttendanceResponseBody {
  meeting_id: string;
  meeting_name: string;
  student_name: string;
  nim: string;
  submitted_at: Date;
}
