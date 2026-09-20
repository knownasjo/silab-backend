import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClassMeeting,
  CGetAllClassMeeting,
  CUpdateMeetingStatus,
} from "../controller/meeting.controller";
import {
  CResetAttendance,
  CUpdateAttendanceManually,
} from "../controller/attendance.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClassMeeting);

router.get("/:id", MAuthUser(), CGetAllClassMeeting);

router.put("/:id/status", MAuthUser(), CUpdateMeetingStatus);

router.put(
  "/:id/attendances/:userId",
  MAuthUser(),
  CUpdateAttendanceManually
);

router.delete("/:id/attendances/:userId", MAuthUser(), CResetAttendance);

export default router;
