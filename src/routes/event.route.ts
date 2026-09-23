import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CStreamEvents } from "../controller/event.controller";

const router = Router();

router.get("/", MAuthUser(), CStreamEvents);

export default router;
