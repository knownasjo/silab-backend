import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CGetPeriods, CStartPeriod } from "../controller/period.controller";

const router = Router();

router.get("/", MAuthUser(), CGetPeriods);

router.post("/", MAuthUser(), CStartPeriod);

export default router;
