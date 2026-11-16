import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CGetActivities } from "../controller/activity.controller";

const router = Router();

router.get("/", MAuthUser(), CGetActivities);

export default router;
