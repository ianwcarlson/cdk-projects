import { nanoid } from "nanoid";

import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_GROUP,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_DEF_ARN,
} from "../environment-variables";
import {
  ECS_TASK_STATE_RUNNING,
  deleteQueue,
  findEcsClusterArn,
  getTaskState,
  runTask,
  stopTask,
} from "../lib/sdk-drivers/ecs/ecs-io";
import {
  createQueue,
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import {
  groupArray,
  importRegionEnvVar,
  sleep,
  validateEnvVar,
} from "../utils";
import { RunTaskCommandOutput } from "@aws-sdk/client-ecs";
import { sqsClient } from "../lib/sdk-drivers/sqs/sqs-client";
import { Message } from "@aws-sdk/client-sqs";
import { JobType } from "./job-types";

const region = importRegionEnvVar();
const clusterArn = validateEnvVar(ECS_CLUSTER_ARN);
const group = validateEnvVar(ECS_GROUP);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const taskDefinitionArn = validateEnvVar(ECS_TASK_DEF_ARN);
const batchParallelism = validateEnvVar(BATCH_PARALLELISM);

const MAX_RETRY_COUNT = 1000;
const MAX_READ_STALL_COUNT = 1000;

interface QueueTaskArns {
  queueUrls: string[];
  taskArns: string[];
}

async function orchestrator() {
  let queueTaskArns: QueueTaskArns | undefined;
  try {
    queueTaskArns = await conductBatchRun();
  } catch (e) {
    console.error("Encountere exception: ", e);
  } finally {
    if (queueTaskArns) {
      await cleanUp(queueTaskArns);
    }
  }
}

async function conductBatchRun() {
  console.log("orchestrator starting");
  // Create job and job status SQS queues

  const uniqueId = nanoid();
  const jobQueueName = `job-queue-${nanoid}`;
  const jobStatusQueueName = `job-status-queue-${nanoid}`;

  console.log("Creating job queue and response state queue");

  const createQueueResponses = await Promise.all([
    createQueue({ queueName: jobQueueName }),
    createQueue({ queueName: jobStatusQueueName }),
  ]);

  const taskPromises = Array.from(Array(batchParallelism)).map((o, i) => {
    return runTask({
      region,
      clusterArn,
      count: 1,
      group,
      securityGroupArns: [securityGroupArn],
      subnetArns: [subnetArn],
      taskDefinitionArn,
      containerName: `batch-worker-${uniqueId}-${i}`,
      environment: {},
    });
  });
  const startedTasks = await Promise.all(taskPromises);

  // Documentation says to wait at least a second, but starting tasks
  // should easily cover that

  let retryCount = MAX_RETRY_COUNT;
  let areAllTasksRunning = false;
  do {
    const getTaskStatePromises = Array.from(Array(batchParallelism)).map(() => {
      return getTaskState({ clusterArn, taskArn: taskDefinitionArn });
    });
    const taskStates = await Promise.all(getTaskStatePromises);
    areAllTasksRunning = taskStates.every(
      (ts) => ts.tasks && ts.tasks[0].lastStatus === ECS_TASK_STATE_RUNNING,
    );
    retryCount -= 1;
    await sleep(500);
  } while (retryCount < MAX_RETRY_COUNT && !areAllTasksRunning);

  if (retryCount === 0) {
    const errorMessage = `Unable to start ${batchParallelism} tasks in RUNNING state`;
    console.log(errorMessage);
    throw new Error(errorMessage);
  }

  const taskArns = startedTasks.reduce(
    (acc: string[], t: RunTaskCommandOutput) => {
      if (t.tasks && t.tasks.length > 0 && t.tasks[0].taskArn) {
        acc.push(t.tasks[0].taskArn);
      }
      return acc;
    },
    [],
  );

  const queueUrls = createQueueResponses.reduce((acc: string[], r) => {
    if (r.QueueUrl) {
      acc.push(r.QueueUrl);
    }
    return acc;
  }, []);

  return { queueUrls, taskArns };
}

async function cleanUp({ queueUrls, taskArns }: QueueTaskArns) {
  for (const taskArn of taskArns) {
    await stopTask({
      region,
      taskArn,
      reason: "Cleaning up batch-processing tasks",
      clusterArn,
    });
  }
  for (const queueUrl of queueUrls) {
    await deleteQueue(queueUrl);
  }
}

interface WriteBatchesInput {
  inputData: Array<string | number>;
  workerQueueUrl: string;
  workerStatusQueueUrl: string;
  jobProperties: object;
}

async function writeBatches({
  inputData,
  workerQueueUrl,
  workerStatusQueueUrl,
  jobProperties,
}: WriteBatchesInput) {
  const currentTime = new Date();
  let writeBatchIdx = 0;
  let readBatchIdx = 0;
  const readStallCounter = MAX_READ_STALL_COUNT;
  const workerPool = new Map();
  const batchParallelism = 6;
  const groupedInputData = groupArray(inputData, 10);
  const numBatches = groupedInputData.length;

  while (readBatchIdx < numBatches && readStallCounter > 0) {
    if (workerPool.size < batchParallelism && writeBatchIdx < numBatches) {
      const numBatchesRemaining = numBatches - writeBatchIdx;
      const numBatchesToAdd = batchParallelism - workerPool.size;
      const numBatchesToAddActual = Math.min(
        numBatchesToAdd,
        numBatchesRemaining,
      );

      const batchIndices = [];
      for (let i = 0; i < numBatchesToAddActual; i++) {
        const taskIds = groupedInputData[i];
        batchIndices.push(writeBatchIdx);
        workerPool.set(writeBatchIdx, { currentTime, taskIds, retries: 0 });
        writeBatchIdx += 1;
      }

      const writeBatchPromises = batchIndices.map((batchIndex) => {
        return writeToWorkerQueue({
          queueUrl: workerQueueUrl,
          batchIndex,
          data: groupedInputData[batchIndex],
          jobProperties,
        });
      });
      await Promise.all(writeBatchPromises);

      const messages = await readFromWorkerStatusQueue({
        queueUrl: workerStatusQueueUrl,
      });

    }
  }
}

interface WriteToWorkerQueueInput {
  queueUrl: string;
  batchIndex: number;
  data: Array<string | number>;
  jobProperties: object; // refine further
}
interface JobMessageBody {
  batchIndex: number;
  data: Array<string | number>;
  jobProperties: object;
}
async function writeToWorkerQueue({
  queueUrl,
  batchIndex,
  data,
  jobProperties,
}: WriteToWorkerQueueInput) {
  const messageBody: JobMessageBody = { batchIndex, data, jobProperties };
  sendMessageBatch({
    queueUrl,
    messages: data.map(() => ({
      id: nanoid(),
      messageBody: JSON.stringify(messageBody),
    })),
  });
}

interface ReadFromWorkerStatusQueueInput {
  queueUrl: string;
}

interface WorkerStatusMessage {
  batchIndex: number;
}
async function readFromWorkerStatusQueue({
  queueUrl,
}: ReadFromWorkerStatusQueueInput) {
  let message;
  let messages: Message[] = [];

  do {
    message = await receiveMessage({ queueUrl });
    if (message && message.Messages) {
      messages = messages.concat(message.Messages);
    }
  } while (message);

  const messageBodies = messages.reduce((acc: JobMessageBody[], m: Message) => {
    if (m.Body) {
      const deserializedBody: JobMessageBody = JSON.parse(m.Body);
      acc.push(deserializedBody)
    }
    return acc;
  }, [])

  return messageBodies;
}

orchestrator().then();
