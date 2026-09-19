import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClassMeeting,
  CGetAllClassMeeting,
} from "../controller/meeting.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClassMeeting);

router.get("/:id", MAuthUser(), CGetAllClassMeeting);

export default router;
