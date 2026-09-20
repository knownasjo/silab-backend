import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClassMeeting,
  CGetAllClassMeeting,
  CUpdateMeetingStatus,
} from "../controller/meeting.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClassMeeting);

router.get("/:id", MAuthUser(), CGetAllClassMeeting);

router.put("/:id/status", MAuthUser(), CUpdateMeetingStatus);

export default router;
