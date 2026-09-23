import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClass,
  CClassRegistration,
  CGetAllClassByPaidActivations,
  CGetAllClasses,
  CGetClassById,
  CGetClassmates,
  CGetMyClasses,
} from "../controller/class.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClass);

router.get("/", MAuthUser(), CGetAllClasses);

router.get("/registration", MAuthUser(), CGetAllClassByPaidActivations);

router.post("/registration", MAuthUser(), CClassRegistration);

router.get("/me", MAuthUser(), CGetMyClasses);

router.get("/:id", MAuthUser(), CGetClassById);

router.get("/:id/classmates", MAuthUser(), CGetClassmates);

export default router;
