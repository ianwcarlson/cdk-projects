import { Router, Request, Response } from "express";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { buildQueueName, conformToExpress } from "./utils";
import {
  createQueue,
  sendMessageBatch,
} from "../../../lib/sdk-drivers/sqs/sqs-io";

const router = Router();

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;
    const messages = _req.body.messages;

    await sendMessageBatch({ queueUrl: buildQueueName(tenantId), messages });
    console.log("Sending messages: " + JSON.stringify(messages, null, 2));

    // await createQueue({ queueName: `${buildQueueName(_req.body.tenantId)}` });

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
