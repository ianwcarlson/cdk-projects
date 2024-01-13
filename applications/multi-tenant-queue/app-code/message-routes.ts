import { Router, Request, Response } from "express";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import {
  receiveMessage,
  deleteMessageBatch,
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
import { RoundRobinQueueMessage } from "./common-types";

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

  if (response && response.Messages && response.Messages[0].Body) {
    const {
      tenantId,
      highPriorityQueueName,
      tenantQueueName,
    }: RoundRobinQueueMessage = JSON.parse(response.Messages[0].Body);

    if (tenantId) {
      // Check the high priority queue first
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

      // Now check the regular queue
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

router.post("/acknowledge", async (req: Request, res: Response) => {
  const _req = conformToExpress(req);
  const receiptHandle = _req.body.receiptHandle;
  const queueUrl = _req.body.queueUrl;
  const id = _req.body.id;

  await deleteMessageBatch({
    queueUrl,
    entries: [{ id, receiptHandle }],
  });

  res.sendStatus(200);
});

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;
    const messages = _req.body.messages;
    const highPriority = _req.body.highPriority;
    const highPriorityQueueName = buildHighPriorityTenantQueueName(tenantId);
    const tenantQueueName = buildTenantQueueName(tenantId);

    const existingTenant = await getTenant(tenantId);
    if (!existingTenant) {
      await createTenantService(tenantId);
    }

    const targetQueueUrl = highPriority
      ? highPriorityQueueName
      : tenantQueueName;
    await sendMessageBatch({
      queueUrl: targetQueueUrl,
      messages,
    });

    const roundRobinQueueMessage: RoundRobinQueueMessage = {
      tenantId,
      highPriorityQueueName,
      tenantQueueName,
    };

    await sendMessageBatch({
      queueUrl: roundRobinQueueUrl,

      messages: [
        {
          id: tenantId,
          messageBody: JSON.stringify(roundRobinQueueMessage),
        },
      ],
    });

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
