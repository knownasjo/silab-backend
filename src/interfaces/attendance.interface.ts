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

export interface IUpdateAttendanceRequestBody {
  status: boolean;
}

export interface IUpdateAttendanceResponseBody {
  meeting_id: string;
  meeting_name: string;
  student_id: string;
  student_name: string;
  nim: string;
  is_attended: boolean;
  submitted_at: Date;
}
