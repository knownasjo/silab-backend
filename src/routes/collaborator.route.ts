import { Router } from "express";
import { MAuthUser } from "../middleware/auth.middleware";
import {
  CAddCollaborators,
  CGetClassCollaborators,
  CRemoveCollaborator,
} from "../controller/collaborator.controller";

const router = Router();

router.post("/", MAuthUser(), CAddCollaborators);

router.get("/:id", MAuthUser(), CGetClassCollaborators);

router.delete("/:classId/:userId", MAuthUser(), CRemoveCollaborator);

export default router;
