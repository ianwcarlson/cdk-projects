import { Router, Request, Response } from "express";

import { v4 as uuidv4 } from "uuid";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import {
  receiveMessage,
  deleteMessageBatch,
  sendMessageBatch,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import { getTenant } from "./dynamo-drivers";
import { adaptReceivedMessages, createTenantService } from "./common";
import { validateEnvVar } from "../../../utils";
import { ROUND_ROBIN_QUEUE_URL } from "../../../environment-variables";
import { RoundRobinQueueMessage } from "./common-types";
import { ReceiveMessageCommandOutput } from "@aws-sdk/client-sqs";

const roundRobinQueueUrl = validateEnvVar(ROUND_ROBIN_QUEUE_URL);

const router = Router();

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;
    const messages: string[] = _req.body.messages;
    const highPriority = _req.body.highPriority;

    let existingTenant = await getTenant(tenantId);
    if (!existingTenant) {
      await createTenantService(tenantId);
      existingTenant = await getTenant(tenantId);
    }

    const formattedMessages = messages.map((message) => {
      return {
        id: uuidv4(),
        messageBody: message,
      };
    });

    // console.log(
    //   "highPriorityQueueUrl: " + existingTenant?.highPriorityQueueUrl,
    // );
    // console.log("queueUrl: " + existingTenant?.queueUrl);

    const targetQueueUrl = highPriority
      ? existingTenant?.highPriorityQueueUrl
      : existingTenant?.queueUrl;
    await sendMessageBatch({
      queueUrl: targetQueueUrl,
      messages: formattedMessages,
    });

    const roundRobinQueueMessage: RoundRobinQueueMessage = {
      tenantId,
      highPriorityQueueName: existingTenant?.highPriorityQueueUrl,
      tenantQueueName: existingTenant?.queueUrl,
    };

    console.log("Sending message: " + JSON.stringify(roundRobinQueueMessage));

    // The goal here is to only have at most one message in the round round queue
    // per tenant to support fairness. SQS FIFO queues will dededuplicate messages
    // based on the messageDuplicationId, which is the tenantId in this case.
    await sendMessageBatch({
      queueUrl: roundRobinQueueUrl,
      messages: [
        {
          id: tenantId,
          messageBody: JSON.stringify(roundRobinQueueMessage),
          messageDeduplicationId: tenantId,
          messageGroupId: tenantId,
        },
      ],
    });

    // console.log("Sending messages: " + JSON.stringify(messages, null, 2));

    res.status(200).send({ message: "Messages sent", status: 200 });
  },
);

router.get("/receive", async (req: Request, res: Response) => {
  const _req = conformToExpress(req);
  const waitTimeSecondsQuery = _req.query.waitTimeSeconds;
  const autoAcknowledgeQuery = _req.query.autoAcknowledge === "true";

  const waitTimeSeconds = waitTimeSecondsQuery
    ? parseInt(waitTimeSecondsQuery.toString()) || 0
    : 0;

  const { response, acknowledgeMessageReceived } = await receiveMessage({
    queueUrl: roundRobinQueueUrl,
    maxNumberOfMessages: 1,
    waitTimeSeconds,
  });

  console.log("Round robin RESPONSE: " + JSON.stringify(response, null, 2));

  if (response && response.Messages && response.Messages[0].Body) {
    await acknowledgeMessageReceived();

    const {
      tenantId,
      highPriorityQueueName,
      tenantQueueName,
    }: RoundRobinQueueMessage = JSON.parse(response.Messages[0].Body);

    async function refreshRoundRobinQueue() {
      const payload: RoundRobinQueueMessage = {
        tenantId,
        highPriorityQueueName,
        tenantQueueName,
      };
      sendMessageBatch({
        queueUrl: roundRobinQueueUrl,
        messages: [
          {
            id: tenantId,
            messageBody: JSON.stringify(payload),
            // We don't want this deduplicated because we want to guarantee
            // the same tenant will get retried at least once again.
            messageDeduplicationId: uuidv4(),
            messageGroupId: tenantId,
          },
        ],
      });
    }

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

      console.log(
        "highPriorityResponse: " +
          JSON.stringify(highPriorityResponse, null, 2),
      );

      if (atLeastOneMessage(highPriorityResponse)) {
        if (autoAcknowledgeQuery) {
          await acknowledgeMessageReceivedHighPriority();
        }
        console.log("Refreshing round robin queue");
        await refreshRoundRobinQueue();
        res
          .status(200)
          .send(adaptReceivedMessages(highPriorityResponse.Messages || []));
        return;
      }

      // Now check the regular queue
      const { response: tenantResponse, acknowledgeMessageReceived } =
        await receiveMessage({
          queueUrl: tenantQueueName,
          maxNumberOfMessages: 1,
          waitTimeSeconds: 0,
        });

      console.log("tenantResponse: " + JSON.stringify(tenantResponse, null, 2));

      if (atLeastOneMessage(tenantResponse)) {
        if (autoAcknowledgeQuery) {
          await acknowledgeMessageReceived();
        }
        console.log("Refreshing round robin queue");
        await refreshRoundRobinQueue();
        res
          .status(200)
          .send(adaptReceivedMessages(tenantResponse.Messages || []));
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

router.delete(
  "/:tenantId",
  // verifyRole([RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    console.log("Deleting tenant");
  },
);

function atLeastOneMessage(message: ReceiveMessageCommandOutput) {
  return message && message.Messages && message.Messages.length > 0;
}

export default router;
