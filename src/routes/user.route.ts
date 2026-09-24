import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CCreateUser,
  CGetUser,
  CResetUserPassword,
} from "../controller/user.controller";

const router = Router();

router.post("/", MAuthUser(), CCreateUser);

router.get("/dosen", MAuthUser(), CGetUser);

router.get("/mahasiswa", MAuthUser(), CGetUser);

router.put("/:account/password", MAuthUser(), CResetUserPassword);

export default router;
