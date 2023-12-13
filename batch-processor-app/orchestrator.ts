import { nanoid } from "nanoid";

import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_GROUP,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  JOB_QUEUE_URL,
  JOB_STATUS_QUEUE_URL,
  WORKER_IMAGE_NAME,
  WORKER_TASK_DEF_ARN,
} from "../environment-variables";
import {
  ECS_TASK_STATE_RUNNING,
  createService,
  getTaskState,
  registerTaskDefinition,
  stopTask,
} from "../lib/sdk-drivers/ecs/ecs-io";
import {
  createQueue,
  deleteQueue,
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import {
  didAnySettledPromisesFail,
  getFulfilledValuesFromSettledPromises,
  groupArray,
  importRegionEnvVar,
  sleep,
  validateEnvVar,
} from "../utils";
import { RunTaskCommandOutput } from "@aws-sdk/client-ecs";
import { CreateQueueCommandOutput, Message } from "@aws-sdk/client-sqs";
import { JobMessageBody, JobStatus, JobStatusMessageBody } from "./job-types";

const region = importRegionEnvVar();
const clusterArn = validateEnvVar(ECS_CLUSTER_ARN);
const group = validateEnvVar(ECS_GROUP);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const workerTaskDefinitionArn = validateEnvVar(WORKER_TASK_DEF_ARN);
const batchParallelism = parseInt(validateEnvVar(BATCH_PARALLELISM));
const executionRoleArn = validateEnvVar(ECS_EXECUTION_ROLE_ARN);
const taskRoleArn = validateEnvVar(ECS_TASK_ROLE_ARN);
const workerImageName = validateEnvVar(WORKER_IMAGE_NAME);

const MAX_RETRY_COUNT = 1000;
const MAX_READ_STALL_COUNT = 1000;
const MAX_WORKER_RETRY_COUNT = 2;

interface QueueTaskArns {
  queueUrls: string[];
  taskArns: string[];
}

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
  let queueUrls: string[] | undefined = [];
  let taskArns: string[] | undefined = [];

  const inputData = await handleGenerateInputData();
  try {
    const responses = await setupPipeline(workerRunCommand);
    queueUrls = responses.queueUrls;
    taskArns = responses.taskArns;

    await writeBatches({
      inputData,
      workerQueueUrl: queueUrls[0],
      workerStatusQueueUrl: queueUrls[1],
      jobProperties: {},
      handleJobStatusResponse,
    });
  } catch (e) {
    console.error("Encountered exception: ", e);
  } finally {
    await cleanUp({ queueUrls, taskArns });
  }
}

async function setupPipeline(workerRunCommand: string[]) {
  console.log("orchestrator starting");

  const uniqueId = nanoid();
  const jobQueueName = `job-queue-${uniqueId}`;
  const jobStatusQueueName = `job-status-queue-${uniqueId}`;

  console.log("Creating job queue and response state queues");

  // Documentation says to wait at least a second, but starting tasks
  // should easily cover that
  const createQueueValues = await createQueues({
    jobQueueName,
    jobStatusQueueName,
  });

  const queueUrls = await extractQueueUrls(createQueueValues);

  console.log("Starting worker tasks");
  const startedTasks = await startWorkerTasks({
    uniqueId,
    jobQueueUrl: queueUrls[0],
    jobStatusQueueUrl: queueUrls[1],
    workerRunCommand,
  });

  // const taskArns = await extractTaskArns(startedTasks);

  await waitForTasksRunning();

  return { queueUrls, taskArns: [] };
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
    if (didAnySettledPromisesFail(createQueueResponses)) {
      throw new Error("Unable to create queues");
    }

    console.log("Queues created");

    const createQueueValues =
      getFulfilledValuesFromSettledPromises(createQueueResponses);
    return createQueueValues;
  } catch (e) {
    console.error("Encountered exception while creating queues: ", e);
    throw e;
  }
}

async function waitForTasksRunning() {
  let retryCount = MAX_RETRY_COUNT;
  let areAllTasksRunning = false;

  console.log("Waiting for tasks to start running");

  do {
    const getTaskStatePromises = Array.from(Array(batchParallelism)).map(() => {
      return getTaskState({ clusterArn, taskArn: workerTaskDefinitionArn });
    });
    const taskStates = await Promise.all(getTaskStatePromises);
    areAllTasksRunning = taskStates.every(
      (ts) => ts.tasks && ts.tasks[0].lastStatus === ECS_TASK_STATE_RUNNING,
    );

    await sleep(500);

    if (retryCount % 10 === 0) {
      console.log(
        `Waiting for tasks to start running. ${retryCount} retries remaining`,
      );
    }

    retryCount -= 1;
  } while (retryCount < MAX_RETRY_COUNT && !areAllTasksRunning);

  if (retryCount === 0) {
    const errorMessage = `Unable to start ${batchParallelism} tasks in RUNNING state`;
    console.log(errorMessage);
    throw new Error(errorMessage);
  }

  console.log(`${batchParallelism} tasks running`);
}

async function extractTaskArns(startedTasks: RunTaskCommandOutput[]) {
  const taskArns = startedTasks.reduce(
    (acc: string[], t: RunTaskCommandOutput) => {
      if (t.tasks && t.tasks.length > 0 && t.tasks[0].taskArn) {
        acc.push(t.tasks[0].taskArn);
      }
      return acc;
    },
    [],
  );
  console.log("Task ARNs: ", taskArns);
  return taskArns;
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
  const currentTime = new Date();
  let writeBatchIdx = 0;
  let readBatchIdx = 0;
  const readStallCounter = MAX_READ_STALL_COUNT;
  const workerPool: Map<
    number,
    { currentTime: Date; taskIds: (string | number)[]; retries: number }
  > = new Map();
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
      await Promise.allSettled(writeBatchPromises);
      // const failed = responses.filter((response, idx, promiseSettledResult) => {
      //   console.log({ promiseSettledResult });
      //   return response.status === "rejected";
      // });

      const messages = await readFromWorkerStatusQueue({
        queueUrl: workerStatusQueueUrl,
      });

      for (const message of messages) {
        const { batchIndex, status } = message;
        const worker = workerPool.get(batchIndex);
        if (worker) {
          workerPool.delete(batchIndex);
          if (status === JobStatus.FAILURE) {
            if (worker.retries < MAX_WORKER_RETRY_COUNT) {
              worker.retries += 1;
              workerPool.set(batchIndex, worker);
            } else {
              console.log(
                `Batch ${batchIndex} failed after ${worker.retries} retries`,
              );
            }
          }
        } else {
          console.error("Unable to find worker for batch index: ", batchIndex);
          console.error("Worker pool: ", workerPool);
        }
      }
      if (handleJobStatusResponse) {
        await handleJobStatusResponse(messages);
      }
    }
  }
}

interface WriteToWorkerQueueInput {
  queueUrl: string;
  batchIndex: number;
  data: Array<string | number>;
  jobProperties: object; // refine further
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

interface StartWorkerTasksInput {
  uniqueId: string;
  jobQueueUrl: string;
  jobStatusQueueUrl: string;
  workerRunCommand: string[];
}
async function startWorkerTasks({
  uniqueId,
  jobQueueUrl,
  jobStatusQueueUrl,
  workerRunCommand,
}: StartWorkerTasksInput) {
  const taskDefinition = await registerTaskDefinition({
    family: `batch-processor-worker-task-${uniqueId}`,
    executionRoleArn: executionRoleArn,
    taskRoleArn: taskRoleArn,
    containerDefinitions: [
      {
        name: `batch-processor-worker-container-${uniqueId}`,
        image: workerImageName,
        memory: 1024,
        cpu: 1024,
        command: workerRunCommand,
        environment: [
          {
            name: JOB_QUEUE_URL,
            value: jobQueueUrl,
          },
          {
            name: JOB_STATUS_QUEUE_URL,
            value: jobStatusQueueUrl,
          },
        ],
      },
    ],
  });
  const createdService = await createService({
    clusterArn,
    serviceName: `batch-processor-worker-service-${uniqueId}`,
    taskDefinitionArn: workerTaskDefinitionArn,
    desiredCount: batchParallelism,
    securityGroups: [securityGroupArn],
    subnets: [subnetArn],
  });
  // Create fargate service with desired count = batchParallelism

  // We're only starting one at a time because we're less likely to get throttled
  // by AWS. Also retries are easier to handle.
  // do {
  //   try {
  //     const task = await runTask({
  //       region,
  //       clusterArn,
  //       count: 1,
  //       group,
  //       securityGroupArns: [securityGroupArn],
  //       subnetArns: [subnetArn],
  //       taskDefinitionArn: workerTaskDefinitionArn,
  //       containerName: `batch-worker-${uniqueId}-${startedTasks.length}`,
  //       environment: {
  //         [JOB_QUEUE_URL]: jobQueueUrl,
  //         [JOB_STATUS_QUEUE_URL]: jobStatusQueueUrl,
  //       },
  //       command: workerRunCommand,
  //     });
  //     startedTasks.push(task);
  //   } catch (e) {
  //     failCount += 1;
  //     console.error("Encountered exception while starting task: ", e);
  //     if (failCount === MAX_RETRY_COUNT) {
  //       throw e;
  //     }
  //   }
  // } while (
  //   startedTasks.length < batchParallelism &&
  //   failCount < MAX_RETRY_COUNT
  // );
  return createdService;
}
