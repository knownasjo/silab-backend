import { Router } from "express";
import {
  CForgotPassword,
  CRefreshAccessToken,
  CResendRegistrationCode,
  CResetPassword,
  CUserLogin,
  CUserMe,
  CUserRegister,
  CVerifyRegistration,
} from "../controller/auth.controller";
import { MAuthUser } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", CUserLogin);

router.post("/refresh", CRefreshAccessToken);

router.post("/register", CUserRegister);

router.post("/register/verify", CVerifyRegistration);

router.post("/register/resend", CResendRegistrationCode);

router.post("/password/forgot", CForgotPassword);

router.post("/password/reset", CResetPassword);

router.get("/me", MAuthUser(), CUserMe);

export default router;
