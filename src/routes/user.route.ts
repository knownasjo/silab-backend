import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CGetUser } from "../controller/user.controller";

const router = Router();

router.get("/dosen", MAuthUser(), CGetUser);

router.get("/asisten", MAuthUser(), CGetUser);

export default router;
