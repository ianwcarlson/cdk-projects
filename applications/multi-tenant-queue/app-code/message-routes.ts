import { Router, Request, Response } from "express";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import {
  receiveMessage,
  sendMessageBatch,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import { getTenant } from "./dynamo-drivers";
import {
  adaptReceivedMessages,
  buildHighPriorityTenantQueueName,
  buildTenantQueueName,
  createTenantService,
} from "./common";
import { validateEnvVar } from "../../../utils";
import { ROUND_ROBIN_QUEUE_URL } from "../../../environment-variables";

const roundRobinQueueUrl = validateEnvVar(ROUND_ROBIN_QUEUE_URL);

const router = Router();

router.get("/receive", async (req: Request, res: Response) => {
  const _req = conformToExpress(req);
  const waitTimeSecondsQuery = _req.query.waitTimeSeconds;
  const autoAcknowledgeQuery = _req.query.autoAcknowledge === "true";

  const waitTimeSeconds = waitTimeSecondsQuery
    ? parseInt(waitTimeSecondsQuery.toString()) || 0
    : 0;

  const { response } = await receiveMessage({
    queueUrl: roundRobinQueueUrl,
    maxNumberOfMessages: 1,
    waitTimeSeconds: 0,
  });

  if (response && response.Messages) {
    const tenantId = response.Messages[0].Body;

    if (tenantId) {
      // Check the high priority queue first
      const highPriorityQueueName = buildHighPriorityTenantQueueName(tenantId);
      const {
        response: highPriorityResponse,
        acknowledgeMessageReceived: acknowledgeMessageReceivedHighPriority,
      } = await receiveMessage({
        queueUrl: highPriorityQueueName,
        maxNumberOfMessages: 1,
        waitTimeSeconds: 0,
      });

      if (
        highPriorityResponse &&
        highPriorityResponse.Messages &&
        highPriorityResponse.Messages.length > 0
      ) {
        if (autoAcknowledgeQuery) {
          await acknowledgeMessageReceivedHighPriority();
        }
        res
          .status(200)
          .send(adaptReceivedMessages(highPriorityResponse.Messages));
        return;
      }

      // Now chec k the regular queue
      const tenantQueueName = buildTenantQueueName(tenantId);
      const { response: tenantResponse, acknowledgeMessageReceived } =
        await receiveMessage({
          queueUrl: tenantQueueName,
          maxNumberOfMessages: 1,
          // This will block for the requested waitTimeSeconds
          waitTimeSeconds,
        });

      if (
        tenantResponse &&
        tenantResponse.Messages &&
        tenantResponse.Messages.length > 0
      ) {
        if (autoAcknowledgeQuery) {
          await acknowledgeMessageReceived();
        }
        res.status(200).send(adaptReceivedMessages(tenantResponse.Messages));
        return;
      }
    }
  }

  res.send([]);
});

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;
    const messages = _req.body.messages;
    const highPriority = _req.body.highPriority;

    const existingTenant = await getTenant(tenantId);
    if (!existingTenant) {
      await createTenantService(tenantId);
    }

    if (highPriority) {
      await sendMessageBatch({
        queueUrl: buildHighPriorityTenantQueueName(tenantId),
        messages,
      });
    } else {
      await sendMessageBatch({
        queueUrl: buildTenantQueueName(tenantId),
        messages,
      });
    }

    console.log("Sending messages: " + JSON.stringify(messages, null, 2));

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
