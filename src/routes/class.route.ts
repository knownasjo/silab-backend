import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddClass,
  CClassRegistration,
  CDeleteClass,
  CGetAllClassByPaidActivations,
  CGetAllClasses,
  CGetClassById,
  CGetClassmates,
  CGetMyClasses,
  CUpdateClass,
} from "../controller/class.controller";

const router = Router();

router.post("/", MAuthUser(), CAddClass);

router.get("/", MAuthUser(), CGetAllClasses);

router.get("/registration", MAuthUser(), CGetAllClassByPaidActivations);

router.post("/registration", MAuthUser(), CClassRegistration);

router.get("/me", MAuthUser(), CGetMyClasses);

router.get("/:id", MAuthUser(), CGetClassById);

router.put("/:id", MAuthUser(), CUpdateClass);

router.delete("/:id", MAuthUser(), CDeleteClass);

router.get("/:id/classmates", MAuthUser(), CGetClassmates);

export default router;
