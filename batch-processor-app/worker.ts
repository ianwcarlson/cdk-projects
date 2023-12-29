import { v4 as uuidv4 } from "uuid";
import { JOB_QUEUE_URL, JOB_STATUS_QUEUE_URL } from "../environment-variables";
import {
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import { validateEnvVar } from "../utils";
import {
  JobMessageBody,
  JobMessageType,
  JobStatusMessageBody,
} from "./job-types";
import { LogBuffer } from "./log-buffer";
import { writeToHeartbeatFile } from "./common";

const MAX_IDLE_COUNT = 1000;

const jobQueueUrl = validateEnvVar(JOB_QUEUE_URL);
const jobStatusQueueUrl = validateEnvVar(JOB_STATUS_QUEUE_URL);

const logger = new LogBuffer("worker");
process.on("exit", (code) => {
  logger.stopLogBuffer(code.toString());
});

interface WorkerProcessInput {
  handleProcessMessage: (
    message: JobMessageBody,
  ) => Promise<JobStatusMessageBody>;
}

export async function workerProcess({
  handleProcessMessage,
}: WorkerProcessInput) {
  logger.log("Worker starting");

  let timeOutCount = MAX_IDLE_COUNT;
  let results: { messageType: JobMessageType } | null = null;

  while (timeOutCount > 0) {
    logger.log("worker timeOutCount: " + timeOutCount);

    try {
      writeToHeartbeatFile();
      results = await processMessage(handleProcessMessage);
    } catch (e) {
      logger.log("Error processing message: " + e);
    }

    if (results?.messageType === JobMessageType.SHUTDOWN) {
      logger.log("Worker shutting down");
      break;
    }

    if (results) {
      timeOutCount = MAX_IDLE_COUNT;
    } else {
      timeOutCount--;
    }
  }

  if (timeOutCount === 0) {
    logger.log("Worker timed out");
  }

  logger.log("Worker stopping");
}

export async function processMessage(
  handleProcessMessage: (
    message: JobMessageBody,
  ) => Promise<JobStatusMessageBody>,
): Promise<{ messageType: JobMessageType } | null> {
  const { response: message, acknowledgeMessageReceived } =
    await receiveMessage({
      queueUrl: jobQueueUrl,
      maxNumberOfMessages: 1,
      waitTimeSeconds: 10,
      visibilityTimeout: 360,
    });
  if (message.Messages && message.Messages.length > 0) {
    const payload: JobMessageBody = JSON.parse(message.Messages[0].Body || "");
    logger.log("Worker message body: " + message.Messages[0].Body);

    if (payload.messageType === JobMessageType.SHUTDOWN) {
      logger.log("Received shutdown message. Worker shutting down");
      return { messageType: payload.messageType };
    }

    const jobStatusMessage = await handleProcessMessage(payload);

    const deleteResponse = await acknowledgeMessageReceived();
    if ((deleteResponse?.Failed || []).length > 0) {
      logger.log("Failed to delete message: " + JSON.stringify(deleteResponse));
    }

    logger.log(
      "Worker sending job status message" + JSON.stringify(jobStatusMessage),
    );

    await sendMessageBatch({
      queueUrl: jobStatusQueueUrl,
      messages: [
        { messageBody: JSON.stringify(jobStatusMessage), id: uuidv4() },
      ],
    });

    return {
      messageType: payload.messageType,
    };
  }
  return null;
}
