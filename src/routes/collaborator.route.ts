import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddCollaborators,
  CGetClassCollaborators,
} from "../controller/collaborator.controller";

const router = Router();

router.post("/", MAuthUser(), CAddCollaborators);

router.get("/:id", MAuthUser(), CGetClassCollaborators);

export default router;
