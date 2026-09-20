import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CAddAttendance } from "../controller/attendance.controller";

const router = Router();

router.post(
  "/:classId/meetings/:meetingId/attendances",
  MAuthUser(),
  CAddAttendance
);

export default router;
