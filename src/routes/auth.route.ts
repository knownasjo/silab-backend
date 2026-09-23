import { Router } from "express";
import {
  CRefreshAccessToken,
  CUserLogin,
  CUserMe,
  CUserRegister,
} from "../controller/auth.controller";
import { MAuthUser } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", CUserLogin);

router.post("/refresh", CRefreshAccessToken);

router.post("/register", CUserRegister);

router.get("/me", MAuthUser(), CUserMe);

export default router;
