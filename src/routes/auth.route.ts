import { Router } from "express";
import {
  CChangePassword,
  CForgotPassword,
  CRefreshAccessToken,
  CResendRegistrationCode,
  CResetPassword,
  CUpdateProfile,
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

router.put("/me", MAuthUser(), CUpdateProfile);

router.put("/me/password", MAuthUser(), CChangePassword);

export default router;
