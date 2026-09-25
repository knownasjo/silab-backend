import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddSession,
  CDeleteSession,
  CGetSessions,
  CUpdateSession,
} from "../controller/session.controller";

const router = Router();

router.get("/", MAuthUser(), CGetSessions);

router.post("/", MAuthUser(), CAddSession);

router.put("/:id", MAuthUser(), CUpdateSession);

router.delete("/:id", MAuthUser(), CDeleteSession);

export default router;
