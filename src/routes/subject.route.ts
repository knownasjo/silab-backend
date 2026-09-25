import { Router } from "express";
import {
  CAddSubject,
  CGetAllSubjects,
  CGetSubjectById,
  CUpdateSubject,
} from "../controller/subject.controller";
import { MAuthUser } from "../middleware/auth.middleware";

const router = Router();

router.post("/", MAuthUser(), CAddSubject);

router.get("/", MAuthUser(), CGetAllSubjects);

router.get("/:id", MAuthUser(), CGetSubjectById);

router.put("/:id", MAuthUser(), CUpdateSubject);

export default router;
