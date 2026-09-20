import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddAnnouncement,
  CDeleteAnnouncement,
  CGetAllAnnouncements,
  CGetAnnouncementById,
  CUpdateAnnouncement,
} from "../controller/announcement.controller";

const router = Router();

router.post("/", MAuthUser(), CAddAnnouncement);

router.get("/", MAuthUser(), CGetAllAnnouncements);

router.get("/:id", MAuthUser(), CGetAnnouncementById);

router.put("/:id", MAuthUser(), CUpdateAnnouncement);

router.delete("/:id", MAuthUser(), CDeleteAnnouncement);

export default router;
