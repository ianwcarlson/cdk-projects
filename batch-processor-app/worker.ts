import { nanoid } from "nanoid";
import { JOB_QUEUE_URL, JOB_STATUS_QUEUE_URL, PROCESS_ID } from "../environment-variables";
import {
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import { validateEnvVar } from "../utils";
import { JobMessageBody, JobStatusMessageBody } from "./job-types";
import { putLogEvents, createLogStream } from "../lib/sdk-drivers/cloudwatch/cloudwatch-io";
import { LogBuffer } from "./log-buffer";

const MAX_IDLE_COUNT = 1000;

const jobQueueUrl = validateEnvVar(JOB_QUEUE_URL);
const jobStatusQueueUrl = validateEnvVar(JOB_STATUS_QUEUE_URL);
const processId = validateEnvVar(PROCESS_ID);

const LogGroupName = "/aws/batch-processor";
const LogStreamName = `worker-${processId}`;

const log = new LogBuffer();

interface WorkerProcessInput {
  handleProcessMessage: (
    message: JobMessageBody,
  ) => Promise<JobStatusMessageBody>;
}

export async function workerProcessInput({
  handleProcessMessage,
}: WorkerProcessInput) {
  await createLogStream({
    logGroupName: LogGroupName,
    logStreamName: LogStreamName,
  });
  
  log.log("Worker starting");

  let timeOutCount = MAX_IDLE_COUNT;

  while (timeOutCount > 0) {
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
      const jobStatusMessage = await handleProcessMessage(payload);

      await acknowledgeMessageReceived();

      log.log("Worker sending job status message" + jobStatusMessage);

      const response = await sendMessageBatch({
        queueUrl: jobStatusQueueUrl,
        messages: [
          { messageBody: JSON.stringify(jobStatusMessage), id: nanoid() },
        ],
      });
      // console.log("Sent message: " + JSON.stringify(response));
    } else {
      timeOutCount -= 1;
    }
  }

  if (timeOutCount === 0) {
    log.log("Worker timed out");
  }

  log.log("Worker stopping");
}
