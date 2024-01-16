import { Router, Request, Response } from "express";

import { v4 as uuidv4 } from "uuid";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import {
  receiveMessage,
  deleteMessageBatch,
  sendMessageBatch,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import { adaptReceivedMessages } from "./common";
import { validateEnvVar } from "../../../utils";
import { RoundRobinQueueMessage } from "./common-types";
import { ReceiveMessageCommandOutput } from "@aws-sdk/client-sqs";
import { HIGH_PRIORITY_QUEUE_URLS, PARALLELISM, QUEUE_URLS } from "../../../environment-variables";

const queueUrls: string[] = JSON.parse(validateEnvVar(QUEUE_URLS));
const highPriorityQueueUrls: string[] = JSON.parse(validateEnvVar(HIGH_PRIORITY_QUEUE_URLS));
const parallelism = parseInt(validateEnvVar(PARALLELISM));

const router = Router();

let queueIndex: number | null = null;

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;
    const messages: string[] = _req.body.messages;
    const highPriority = _req.body.highPriority;
    const groupId = _req.body.groupId;

    // Determine which queue to send to.
    // This is a very cheap way of uniformly distributing messages across
    // each queue. It's not perfect, but it's good enough for most use cases.
    // We leverage the peristance of the lambda global scope across invocations 
    // to keep track of the queue index. If the lambda is cold started, then
    // pick a random integer between 0 and the parallelism value. It's ok if some
    // of the queues have a few more messages than others.
    if (queueIndex === null) {
      queueIndex = getRandomInt(0, parallelism);
    } else {
      queueIndex = queueIndex + 1;
      if (queueIndex >= parallelism) {
        queueIndex = 0;
      }
    }

    const formattedMessages = messages.map((message) => {
      return {
        id: uuidv4(),
        messageBody: message,
      };
    });

    await sendMessageBatch({
      queueUrl: highPriority ? highPriorityQueueUrls[queueIndex]: queueUrls[queueIndex],
      messages: [
        {
          id: tenantId,
          messageBody: JSON.stringify(formattedMessages),
          messageGroupId: groupId,
        },
      ],
    });

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

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function atLeastOneMessage(message: ReceiveMessageCommandOutput) {
  return message && message.Messages && message.Messages.length > 0;
}

export default router;
