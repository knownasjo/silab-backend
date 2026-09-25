import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CGetLecturerDashboard } from "../controller/dashboard.controller";

const router = Router();

router.get("/dosen", MAuthUser(), CGetLecturerDashboard);

export default router;
