import { JobMessageBody, JobStatus, JobStatusMessageBody } from "./job-types";
import { LogBuffer } from "./log-buffer";
import { workerProcessInput } from "./worker";

const log = new LogBuffer("worker");

async function handleProcessMessage(
  message: JobMessageBody,
): Promise<JobStatusMessageBody> {
  log.log("Processing message" + JSON.stringify(message));

  // This is where you would do the actual work of the job

  return {
    batchIndex: message.batchIndex,
    status: JobStatus.SUCCESS,
    processedData: message.data,
    jobProperties: message.jobProperties,
  };
}

workerProcessInput({ handleProcessMessage }).then();
