import { Router, Request, Response } from "express";
import { RbacRoles, verifyRole } from "./rbac-roles";

const router = Router();

router.post(
  "/",
  verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    console.log("Request payload: " + JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
  },
);

router.get(
  "/:userId",
  verifyRole([RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    res.status(200).send({
      userId: req.params.userId,
    });
  },
);

export default router;
