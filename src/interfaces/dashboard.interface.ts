export interface ILecturerDashboardResponseBody {
  total_class: number;
  total_student: number;
  total_meeting: number;
  total_attended: number;
  total_expected_attendance: number;
  attendance_rate: number | null;
}
