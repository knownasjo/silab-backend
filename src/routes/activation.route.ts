import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddActivation,
  CGetAllActivations,
  CUpdateActivationPaymentStatus,
} from "../controller/activation.controller";

const router = Router();

router.post("/", MAuthUser(), CAddActivation);

router.get("/", MAuthUser(), CGetAllActivations);

router.put("/:id", MAuthUser(), CUpdateActivationPaymentStatus);

export default router;
