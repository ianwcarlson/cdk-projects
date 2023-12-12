import { JobMessageBody, JobStatus, JobStatusMessageBody } from "./job-types";
import { workerProcessInput } from "./worker";

async function handleProcessMessage(
  message: JobMessageBody,
): Promise<JobStatusMessageBody> {
  console.log("Processing message", message);

  return {
    batchIndex: message.batchIndex,
    status: JobStatus.SUCCESS,
    processedData: message.data,
    jobProperties: message.jobProperties,
  };
}

workerProcessInput({ handleProcessMessage }).then();
