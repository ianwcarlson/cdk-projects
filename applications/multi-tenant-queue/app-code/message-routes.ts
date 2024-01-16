import { Router, Request, Response } from "express";

import { v4 as uuidv4 } from "uuid";
// import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import {
  receiveMessage,
  deleteMessageBatch,
  sendMessageBatch,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import { adaptReceivedMessages, decodeReceiptHandle } from "./common";
import { validateEnvVar } from "../../../utils";
import { RoundRobinQueueMessage } from "./common-types";
import { ReceiveMessageCommandOutput } from "@aws-sdk/client-sqs";
import {
  HIGH_PRIORITY_QUEUE_URLS,
  PARALLELISM,
  QUEUE_URLS,
} from "../../../environment-variables";

const queueUrls: string[] = JSON.parse(validateEnvVar(QUEUE_URLS));
const highPriorityQueueUrls: string[] = JSON.parse(
  validateEnvVar(HIGH_PRIORITY_QUEUE_URLS),
);
const parallelism = parseInt(validateEnvVar(PARALLELISM));

const router = Router();

let writeIndex: number | null = null;
let readIndex: number | null = null;

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
    if (writeIndex === null) {
      writeIndex = getRandomInt(0, parallelism);
    } else {
      writeIndex = writeIndex + 1;
      if (writeIndex >= parallelism) {
        writeIndex = 0;
      }
    }

    const formattedMessages = messages.map((message) => {
      return {
        id: uuidv4(),
        messageBody: message,
      };
    });

    await sendMessageBatch({
      queueUrl: highPriority
        ? highPriorityQueueUrls[writeIndex]
        : queueUrls[writeIndex],
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
  const { query } = conformToExpress(req);
  const autoAcknowledgeQuery = query.autoAcknowledge === "true";

  if (readIndex === null) {
    readIndex = getRandomInt(0, parallelism);
  } else {
    readIndex = readIndex + 1;
    if (readIndex >= parallelism) {
      readIndex = 0;
    }
  }

  console.log("READ INDEEX", readIndex);

  for (let i = readIndex; i < parallelism + readIndex; i++) {
    const index = i % parallelism;
    const {
      response: highPriorityResponse,
      acknowledgeMessageReceived: highPriorityAcknowledgeMessageReceived,
    } = await receiveMessage({
      queueUrl: highPriorityQueueUrls[index],
      maxNumberOfMessages: 1,
      waitTimeSeconds: 0,
    });

    console.log(
      "highPriorityResponse: " + JSON.stringify(highPriorityResponse, null, 2),
    );

    if (atLeastOneMessage(highPriorityResponse)) {
      if (autoAcknowledgeQuery) {
        await highPriorityAcknowledgeMessageReceived();
      }
      res.status(200).send(
        adaptReceivedMessages({
          messages: highPriorityResponse.Messages || [],
          queueUrl: queueUrls[readIndex],
        }),
      );
      return;
    }

    const { response, acknowledgeMessageReceived } = await receiveMessage({
      queueUrl: queueUrls[readIndex],
      maxNumberOfMessages: 1,
      waitTimeSeconds: 0,
    });

    console.log("response: " + JSON.stringify(response, null, 2));

    if (atLeastOneMessage(response)) {
      if (autoAcknowledgeQuery) {
        await acknowledgeMessageReceived();
      }
      res.status(200).send(
        adaptReceivedMessages({
          messages: response.Messages || [],
          queueUrl: queueUrls[readIndex],
        }),
      );
      return;
    }
  }

  res.status(200).send([]);
});

interface AcknowledgeRequest {
  receiptHandle: string;
  queueUrl: string;
  id: string;
}

router.post("/acknowledge", async (req: Request, res: Response) => {
  const { receiptHandle }: AcknowledgeRequest = conformToExpress(req).body;

  const { id, queueUrl, receiptHandle: awsReceiptHandle } =
    decodeReceiptHandle(receiptHandle);

  await deleteMessageBatch({
    queueUrl,
    entries: [{ id, receiptHandle: awsReceiptHandle }],
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
