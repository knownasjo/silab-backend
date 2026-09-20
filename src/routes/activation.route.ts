import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddActivation,
  CGetAllActivations,
  CUpdateActivationPaymentStatus,
  CUpdateStudentClass,
} from "../controller/activation.controller";

const router = Router();

router.post("/", MAuthUser(), CAddActivation);

router.get("/", MAuthUser(), CGetAllActivations);

router.put("/:id", MAuthUser(), CUpdateActivationPaymentStatus);

router.put("/:id/class", MAuthUser(), CUpdateStudentClass);

export default router;
