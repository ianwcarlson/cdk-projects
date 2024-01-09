import { Router, Request, Response } from "express";
import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";

const router = Router();

router.post(
  "/",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    console.log("Path payload: " + JSON.stringify(_req.path, null, 2));
    console.log("Request payload: " + JSON.stringify(_req.body, null, 2));
    console.log("Request params: " + JSON.stringify(_req.params, null, 2));
    res.sendStatus(200);
  },
);

router.get(
  "/:userId",
  // verifyRole([RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    console.log("Path payload: " + JSON.stringify(_req.path, null, 2));
    console.log("Request params: " + JSON.stringify(_req.params, null, 2));
    res.send({
      userId: _req.params.userId,
    });
  },
);

export default router;
