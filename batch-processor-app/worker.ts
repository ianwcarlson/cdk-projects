import path from "path";
import fs from "fs";

import { nanoid } from "nanoid";
import {
  JOB_QUEUE_URL,
  JOB_STATUS_QUEUE_URL,
  PROCESS_ID,
} from "../environment-variables";
import {
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import { validateEnvVar } from "../utils";
import { JobMessageBody, JobStatusMessageBody } from "./job-types";
import { LogBuffer } from "./log-buffer";
import { writeToHeartbeatFile } from "./common";

const MAX_IDLE_COUNT = 1000;

const jobQueueUrl = validateEnvVar(JOB_QUEUE_URL);
const jobStatusQueueUrl = validateEnvVar(JOB_STATUS_QUEUE_URL);

const log = new LogBuffer("worker");

interface WorkerProcessInput {
  handleProcessMessage: (
    message: JobMessageBody,
  ) => Promise<JobStatusMessageBody>;
}

export async function workerProcessInput({
  handleProcessMessage,
}: WorkerProcessInput) {
  log.log("Worker starting");

  let timeOutCount = MAX_IDLE_COUNT;

  while (timeOutCount > 0) {
    log.log("worker timeOutCount: " + timeOutCount);
    writeToHeartbeatFile();

    const { response: message, acknowledgeMessageReceived } =
      await receiveMessage({
        queueUrl: jobQueueUrl,
        maxNumberOfMessages: 1,
        waitTimeSeconds: 10,
        visibilityTimeout: 360,
      });
    if (message.Messages && message.Messages.length > 0) {
      timeOutCount = MAX_IDLE_COUNT;
      const payload: JobMessageBody = JSON.parse(
        message.Messages[0].Body || "",
      );
      log.log("Worker message body: " + payload);
      const jobStatusMessage = await handleProcessMessage(payload);

      const deleteResponse = await acknowledgeMessageReceived();
      if ((deleteResponse?.Failed || []).length > 0) {
        log.log("Failed to delete message: " + JSON.stringify(deleteResponse));
      }

      log.log(
        "Worker sending job status message" + JSON.stringify(jobStatusMessage),
      );

      const response = await sendMessageBatch({
        queueUrl: jobStatusQueueUrl,
        messages: [
          { messageBody: JSON.stringify(jobStatusMessage), id: nanoid() },
        ],
      });
      // console.log("Sent message: " + JSON.stringify(response));
      timeOutCount = MAX_IDLE_COUNT;
    } else {
      timeOutCount -= 1;
    }
  }

  if (timeOutCount === 0) {
    log.log("Worker timed out");
  }

  log.log("Worker stopping");
}
