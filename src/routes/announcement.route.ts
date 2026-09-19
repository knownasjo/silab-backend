import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddAnnouncement,
  CGetAllAnnouncements,
  CGetAnnouncementById,
} from "../controller/announcement.controller";

const router = Router();

router.post("/", MAuthUser(), CAddAnnouncement);

router.get("/", MAuthUser(), CGetAllAnnouncements);

router.get("/:id", MAuthUser(), CGetAnnouncementById);

export default router;
