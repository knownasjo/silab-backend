export interface ILecturerDashboardResponseBody {
  totalClass: number;
  totalStudent: number;
  totalMeeting: number;
  totalAttended: number;
  totalExpectedAttendance: number;
  attendanceRate: number | null;
}
