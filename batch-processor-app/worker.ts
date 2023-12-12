import { JOB_QUEUE_URL, JOB_STATUS_QUEUE_URL } from "../environment-variables";
import { receiveMessage } from "../lib/sdk-drivers/sqs/sqs-io";
import { validateEnvVar } from "../utils";
import { JobMessageBody } from "./job-types";

const MAX_IDLE_COUNT = 1000;

const jobQueueUrl = validateEnvVar(JOB_QUEUE_URL);
const jobStatusQueueUrl = validateEnvVar(JOB_STATUS_QUEUE_URL);

async function main() {
  console.log("Worker starting");

  let timeOutCount = MAX_IDLE_COUNT;

  while (timeOutCount > 0) {
    // poll job status queue
    // if job is available, process it
    const message = await receiveMessage({
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
    } else {
      timeOutCount -= 1;
    }
  }

  if (timeOutCount === 0) {
    console.log("Worker timed out");
  }

  console.log("Worker stopping");
}

main().then();
