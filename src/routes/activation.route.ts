import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddActivation,
  CDeleteActivation,
  CGetAllActivations,
  CUpdateActivationPaymentStatus,
  CUpdateStudentClass,
} from "../controller/activation.controller";

const router = Router();

router.post("/", MAuthUser(), CAddActivation);

router.get("/", MAuthUser(), CGetAllActivations);

router.put("/:id", MAuthUser(), CUpdateActivationPaymentStatus);

router.put("/:id/class", MAuthUser(), CUpdateStudentClass);

router.delete("/:id", MAuthUser(), CDeleteActivation);

export default router;
