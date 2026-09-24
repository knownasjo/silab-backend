import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import { CCreateUser, CGetUser } from "../controller/user.controller";

const router = Router();

router.post("/", MAuthUser(), CCreateUser);

router.get("/dosen", MAuthUser(), CGetUser);

router.get("/mahasiswa", MAuthUser(), CGetUser);

export default router;
