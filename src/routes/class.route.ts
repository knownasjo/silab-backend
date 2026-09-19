import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClass,
  CClassRegistration,
  CGetAllClassByPaidActivations,
  CGetAllClasses,
  CGetClassById,
} from "../controller/class.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClass);

router.get("/", MAuthUser(), CGetAllClasses);

router.get("/registration", MAuthUser(), CGetAllClassByPaidActivations);

router.post("/registration", MAuthUser(), CClassRegistration);

router.get("/:id", MAuthUser(), CGetClassById);

export default router;
