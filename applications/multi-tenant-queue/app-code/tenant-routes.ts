import { Router, Request, Response } from "express";
import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import { createQueue } from "../../../lib/sdk-drivers/sqs/sqs-io";

const router = Router();

router.post(
  "/",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    console.log("Creating tenant");

    await createQueue({ queueName: `tenant-queue-${_req.body.tenantId}` });

    res.sendStatus(200);
  },
);

router.delete(
  "/:tenantId",
  // verifyRole([RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    console.log("Deleting tenant");
  },
);

export default router;
