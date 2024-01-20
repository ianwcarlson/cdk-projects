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
import { getEnvironmentParallelism, validateEnvVar } from "../../../utils";
import { ReceiveMessageCommandOutput } from "@aws-sdk/client-sqs";
import {
  HIGH_PRIORITY_QUEUE_URLS,
  QUEUE_URLS,
} from "../../../environment-variables";

const queueUrls: string[] = JSON.parse(validateEnvVar(QUEUE_URLS));
const highPriorityQueueUrls: string[] = JSON.parse(
  validateEnvVar(HIGH_PRIORITY_QUEUE_URLS),
);
const parallelism = getEnvironmentParallelism();

const router = Router();

let writeIndex: number | null = null;
let readIndex: number | null = null;

interface SendMessageRequest {
  messages: { payload: string; deduplicationId?: string }[];
  highPriority: boolean;
  groupId: string;
}

router.post(
  "/send",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const { messages, highPriority, groupId }: SendMessageRequest =
      conformToExpress(req).body;

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
      // By default, deduplication is disabled
      const finalDedupeId = message.deduplicationId || uuidv4();
      return {
        id: uuidv4(),
        messageBody: message.payload,
        messageGroupId: groupId,
        messageDeduplicationId: finalDedupeId,
      };
    });

    await sendMessageBatch({
      queueUrl: highPriority
        ? highPriorityQueueUrls[writeIndex]
        : queueUrls[writeIndex],
      messages: formattedMessages,
    });

    res.status(200).send({ message: "Messages sent", status: 200 });
  },
);

router.get("/receive", async (req: Request, res: Response) => {
  // const { query } = conformToExpress(req);
  // @ts-ignore
  const autoAcknowledgeQuery = req.query.autoAcknowledge === true;
  // console.log("query", JSON.stringify(query));

  if (readIndex === null) {
    console.log("readIndex is null");
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
      maxNumberOfMessages: 10,
      waitTimeSeconds: 0,
    });

    console.log(
      "highPriorityResponse: " + JSON.stringify(highPriorityResponse, null, 2),
    );

    if (atLeastOneMessage(highPriorityResponse)) {
      if (autoAcknowledgeQuery) {
        console.log("acknowledging high priority message");
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
      maxNumberOfMessages: 10,
      waitTimeSeconds: 0,
    });

    console.log("response: " + JSON.stringify(response, null, 2));

    if (atLeastOneMessage(response)) {
      if (autoAcknowledgeQuery) {
        console.log("acknowledging message");
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
  receiptHandles: string[];
}

router.post("/acknowledge", async (req: Request, res: Response) => {
  const { receiptHandles }: AcknowledgeRequest = conformToExpress(req).body;

  console.log("req.body", JSON.stringify(req.body, null, 2));

  const decodedReceiptHandles = receiptHandles.map((receiptHandle) => {
    const {
      id,
      queueUrl,
      receiptHandle: awsReceiptHandle,
    } = decodeReceiptHandle(receiptHandle);
    return { id, queueUrl, receiptHandle: awsReceiptHandle };
  });

  decodedReceiptHandles.forEach(async ({ id, queueUrl, receiptHandle }) => {
    await deleteMessageBatch({
      queueUrl,
      entries: [{ id, receiptHandle }],
    });
  });

  res.sendStatus(200);
});

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); // The maximum is
}

function atLeastOneMessage(message: ReceiveMessageCommandOutput) {
  return message && message.Messages && message.Messages.length > 0;
}

export default router;
