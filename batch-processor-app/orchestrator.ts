import { v4 as uuidv4 } from "uuid";

import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  JOB_QUEUE_URL,
  JOB_STATUS_QUEUE_URL,
  LOG_GROUP_NAME,
  PROCESS_ID,
  REGION,
  WORKER_IMAGE_NAME,
} from "../environment-variables";
import {
  createService,
  deleteService,
  deleteTaskDefinitions as deleteTaskDefinitions,
  registerTaskDefinition,
  stopTasksInService,
} from "../lib/sdk-drivers/ecs/ecs-io";
import {
  createQueue,
  deleteQueue,
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import {
  getFailedValuesFromSettledPromises,
  getFulfilledValuesFromSettledPromises,
  groupArray,
  importRegionEnvVar,
  validateEnvVar,
} from "../utils";
import { AssignPublicIp } from "@aws-sdk/client-ecs";
import { CreateQueueCommandOutput, Message } from "@aws-sdk/client-sqs";
import {
  JobMessageBody,
  JobMessageType,
  JobStatus,
  JobStatusMessageBody,
} from "./job-types";
import { LogBuffer } from "./log-buffer";
import { writeToHeartbeatFile } from "./common";

const region = importRegionEnvVar();
const clusterArn = validateEnvVar(ECS_CLUSTER_ARN);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const batchParallelism = parseInt(validateEnvVar(BATCH_PARALLELISM));
const executionRoleArn = validateEnvVar(ECS_EXECUTION_ROLE_ARN);
const taskRoleArn = validateEnvVar(ECS_TASK_ROLE_ARN);
const workerImageName = validateEnvVar(WORKER_IMAGE_NAME);
const logGroupName = validateEnvVar(LOG_GROUP_NAME);

const processId = new Date().toISOString().replace(/[:.]/g, "-");

const MAX_RETRY_COUNT = 1000;
const MAX_READ_STALL_COUNT = 10;
const WorkerMemoryMB = 1024;
const WorkerCpu = 512;

const logger = new LogBuffer("orchestrator");
process.on("exit", (code) => {
  logger.stopLogBuffer(code.toString());
});

interface OrchestratorInput {
  handleGenerateInputData: { (): Promise<Array<string | number>> };
  handleJobStatusResponse?: {
    (response: JobStatusMessageBody[]): Promise<void>;
  };
  workerRunCommand: string[];
}

export async function orchestrator({
  handleGenerateInputData,
  handleJobStatusResponse,
  workerRunCommand,
}: OrchestratorInput) {
  let queueUrls:
    | {
        jobQueueUrl: string;
        jobStatusQueueUrl: string;
      }
    | undefined;
  let serviceArn: string | undefined;
  let taskDefinitionArn: string | undefined;

  const inputData = await handleGenerateInputData();
  try {
    const services = await setupPipeline(workerRunCommand);
    queueUrls = services.queueUrls;
    serviceArn = services.workerServiceArn;
    taskDefinitionArn = services.taskDefinitionArn;
    console.log("taskDefinitionArn: ", taskDefinitionArn);

    await writeBatches({
      inputData,
      workerQueueUrl: queueUrls.jobQueueUrl,
      workerStatusQueueUrl: queueUrls.jobStatusQueueUrl,
      jobProperties: {},
      handleJobStatusResponse,
    });

    if (services.workerServiceArn) {
      await stopTasksInService({
        serviceName: services.workerServiceArn,
        clusterArn,
      });
    }
  } catch (e) {
    console.error("Encountered exception: ", e);
  } finally {
    await cleanUp({
      queueUrls: [queueUrls?.jobQueueUrl, queueUrls?.jobStatusQueueUrl],
      workerServiceArn: serviceArn,
      taskDefinitionArn,
    });
  }
}

async function setupPipeline(workerRunCommand: string[]) {
  writeToHeartbeatFile();

  logger.log("orchestrator starting");

  const jobQueueName = `job-queue-${processId}`;
  const jobStatusQueueName = `job-status-queue-${processId}`;

  logger.log("Creating job queue and response state queues");

  // Documentation says to wait at least a second, but starting tasks
  // should easily cover that
  const { jobQueueUrl, jobStatusQueueUrl } = await createQueues({
    jobQueueName,
    jobStatusQueueName,
  });

  logger.log("Creating worker task definition");

  const workerTaskDefinitionResponse = await registerTaskDefinition({
    family: `batch-processor-worker-family-${processId}`,
    taskRoleArn,
    executionRoleArn,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    memory: WorkerMemoryMB.toString(),
    cpu: WorkerCpu.toString(),
    containerDefinitions: [
      {
        name: `batch-processor-worker-container-${processId}`,
        image: workerImageName,
        memory: WorkerMemoryMB,
        cpu: WorkerCpu,
        command: workerRunCommand,
        entryPoint: ["sh", "-c"],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroupName,
            "awslogs-region": region,
            "awslogs-stream-prefix": "worker",
          },
        },
        environment: [
          {
            name: JOB_QUEUE_URL,
            value: jobQueueUrl,
          },
          {
            name: JOB_STATUS_QUEUE_URL,
            value: jobStatusQueueUrl,
          },
          {
            name: REGION,
            value: region,
          },
          {
            name: ECS_CLUSTER_ARN,
            value: clusterArn,
          },
          {
            name: ECS_SECURITY_GROUP_ARN,
            value: securityGroupArn,
          },
          {
            name: ECS_SUBNET_ARN,
            value: subnetArn,
          },
          {
            name: PROCESS_ID,
            value: processId,
          },
        ],
        healthCheck: {
          command: ["CMD-SHELL", "bash healthcheck.sh"],
          interval: 60,
          retries: 5,
          startPeriod: 60,
          timeout: 30,
        },
      },
    ],
  });

  if (
    !workerTaskDefinitionResponse.taskDefinition ||
    !workerTaskDefinitionResponse.taskDefinition.taskDefinitionArn
  ) {
    throw new Error(
      "Unable to create worker task definition: " +
        JSON.stringify(workerTaskDefinitionResponse),
    );
  }

  logger.log("Creating worker service");

  const taskDefinitionArn =
    workerTaskDefinitionResponse.taskDefinition.taskDefinitionArn;

  // The Fargate service will ensure that the desired number of worker tasks are running
  // at all times. If a task fails, it will be restarted.
  const createdService = await createService({
    clusterArn,
    serviceName: `batch-processor-worker-service-${processId}`,
    taskDefinitionArn,
    desiredCount: batchParallelism,
    securityGroups: [securityGroupArn],
    subnets: [subnetArn],
    assignPublicIp: AssignPublicIp.ENABLED,
  });

  return {
    queueUrls: { jobQueueUrl, jobStatusQueueUrl },
    workerServiceArn: createdService.service?.serviceArn,
    workerServiceName: createdService.service?.serviceName,
    taskDefinitionArn,
  };
}

interface QueueTaskArns {
  queueUrls: (string | undefined)[];
  workerServiceArn: string | undefined;
  taskDefinitionArn: string | undefined;
}

async function cleanUp({
  queueUrls,
  workerServiceArn,
  taskDefinitionArn,
}: QueueTaskArns) {
  logger.log("Cleaning up");

  writeToHeartbeatFile();

  if (taskDefinitionArn) {
    logger.log("Deleting task definition: " + taskDefinitionArn);
    await deleteTaskDefinitions([taskDefinitionArn]);
  }

  if (workerServiceArn) {
    await deleteService({
      serviceArn: workerServiceArn,
      clusterArn,
    });
  }

  writeToHeartbeatFile();

  for (const queueUrl of queueUrls) {
    if (queueUrl) {
      await deleteQueue(queueUrl);
    }
  }

  writeToHeartbeatFile();
}

interface CreateQueuesInput {
  jobQueueName: string;
  jobStatusQueueName: string;
}

async function createQueues({
  jobQueueName,
  jobStatusQueueName,
}: CreateQueuesInput) {
  try {
    const createQueueResponses = await Promise.allSettled([
      createQueue({ queueName: jobQueueName }),
      createQueue({ queueName: jobStatusQueueName }),
    ]);

    const failedResponses =
      getFailedValuesFromSettledPromises(createQueueResponses);
    if (failedResponses.length > 0) {
      console.error("Unable to create queues: ", failedResponses);
      throw new Error("Unable to create queues");
    }

    const createQueueValues =
      getFulfilledValuesFromSettledPromises(createQueueResponses);

    const queueUrls = await extractQueueUrls(createQueueValues);

    return {
      jobQueueUrl: queueUrls[0],
      jobStatusQueueUrl: queueUrls[1],
    };
  } catch (e) {
    console.error("Encountered exception while creating queues: ", e);
    throw e;
  }
}

async function extractQueueUrls(
  createQueueValues: (CreateQueueCommandOutput | null)[],
) {
  const queueUrls = createQueueValues.reduce((acc: string[], r) => {
    if (r && r.QueueUrl) {
      acc.push(r.QueueUrl);
    }
    return acc;
  }, []);
  console.log("Queue URLs: ", queueUrls);
  return queueUrls;
}

interface WriteBatchesInput {
  inputData: Array<string | number>;
  workerQueueUrl: string;
  workerStatusQueueUrl: string;
  jobProperties: object;
  handleJobStatusResponse?: {
    (response: JobStatusMessageBody[]): Promise<void>;
  };
}

async function writeBatches({
  inputData,
  workerQueueUrl,
  workerStatusQueueUrl,
  jobProperties,
  handleJobStatusResponse,
}: WriteBatchesInput) {
  let writeBatchIdx = 0;
  let readBatchIdx = 0;
  let readStallCounter = MAX_READ_STALL_COUNT;
  const groupedInputData = groupArray(inputData, 10);
  const numBatches = groupedInputData.length;
  logger.log("numBatches: " + numBatches);

  while (readBatchIdx < numBatches && readStallCounter > 0) {
    writeToHeartbeatFile();

    readStallCounter -= 1;

    logger.log("readStallCounter: " + readStallCounter);
    logger.log("readBatchIdx: " + readBatchIdx);
    logger.log("writeBatchIdx: " + writeBatchIdx);
    if (readBatchIdx < numBatches) {
      const numBatchesRemaining = numBatches - writeBatchIdx;
      const numBatchesToAdd = batchParallelism;
      const numBatchesToAddActual = Math.min(
        numBatchesToAdd,
        numBatchesRemaining,
      );

      const batchIndices = [];
      for (let i = 0; i < numBatchesToAddActual; i++) {
        const taskIds = groupedInputData[i];
        batchIndices.push(writeBatchIdx);
        writeBatchIdx += 1;
      }

      const writeBatchPromises = batchIndices.map((batchIndex) => {
        logger.log("Writing batch " + batchIndex + " to queue");
        return writeToWorkerQueue({
          queueUrl: workerQueueUrl,
          batchIndex,
          data: groupedInputData[batchIndex],
          jobProperties,
          messageType: JobMessageType.DATA,
        });
      });
      await Promise.allSettled(writeBatchPromises);

      // We could just write everything to the job queue and then read from the
      // status queue at the end, but by checking the status queue periodically
      // we can potentially respond to events quicker. Example: logic can be added
      // to the orchestrator to create different types of jobs depending on various
      // conditions.
      const messages = await readFromWorkerStatusQueue({
        queueUrl: workerStatusQueueUrl,
      });

      for (const message of messages) {
        const { batchIndex, status } = message;
        logger.log("batchIndex: " + batchIndex);
        logger.log("status: " + status);

        readBatchIdx += 1;
        logger.log("readBatchIdx: " + readBatchIdx);
        if (status === JobStatus.FAILURE) {
          logger.log("Worker failed for batch index: " + batchIndex);
        }
      }

      if (handleJobStatusResponse) {
        await handleJobStatusResponse(messages);
      }
    }
  }

  Array.from(new Array(batchParallelism)).forEach(async () => {
    console.log("Sending shutdown message to worker queue");
    await writeToWorkerQueue({
      queueUrl: workerQueueUrl,
      batchIndex: -1,
      data: [],
      jobProperties,
      messageType: JobMessageType.SHUTDOWN,
    });
  });
}

interface WriteToWorkerQueueInput {
  queueUrl: string;
  batchIndex: number;
  data: Array<string | number>;
  jobProperties: object; // refine further
  messageType: JobMessageType;
}

// We are not using FIFO queues because we don't have a use-case for it yet.
async function writeToWorkerQueue({
  queueUrl,
  batchIndex,
  data,
  jobProperties,
  messageType,
}: WriteToWorkerQueueInput) {
  const messageBody: JobMessageBody = {
    batchIndex,
    data,
    jobProperties,
    messageType,
  };
  sendMessageBatch({
    queueUrl,
    messages: [
      {
        id: uuidv4(),
        messageBody: JSON.stringify(messageBody),
      },
    ],
  });
}

interface ReadFromWorkerStatusQueueInput {
  queueUrl: string;
}

async function readFromWorkerStatusQueue({
  queueUrl,
}: ReadFromWorkerStatusQueueInput) {
  let messages: Message[] = [];
  let retryCount = MAX_RETRY_COUNT;

  // accumulate messages until we get an empty response. Don't
  // wait that long because we want to stuff the job queue as
  // fast as possible.
  do {
    const { response: message, acknowledgeMessageReceived } =
      await receiveMessage({ queueUrl, waitTimeSeconds: 1 });
    if (message && message.Messages && message.Messages.length > 0) {
      messages = messages.concat(message.Messages);
      await acknowledgeMessageReceived();
      retryCount -= 1;
    } else {
      break;
    }
  } while (retryCount > 0);

  const messageBodies = messages.reduce(
    (acc: JobStatusMessageBody[], m: Message) => {
      if (m.Body) {
        const deserializedBody: JobStatusMessageBody = JSON.parse(m.Body);
        acc.push(deserializedBody);
      }
      return acc;
    },
    [],
  );

  return messageBodies;
}
