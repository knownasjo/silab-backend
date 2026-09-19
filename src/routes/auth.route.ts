import { Router } from "express";
import {
  CUserLogin,
  CUserMe,
  CUserRegister,
} from "../controller/auth.controller";
import { MAuthUser } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", CUserLogin);

router.post("/register", CUserRegister);

router.get("/me", MAuthUser(), CUserMe);

export default router;
