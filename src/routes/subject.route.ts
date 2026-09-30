import { Router } from "express";
import {
  CAddSubject,
  CDeleteSubject,
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

router.delete("/:id", MAuthUser(), CDeleteSubject);

export default router;
