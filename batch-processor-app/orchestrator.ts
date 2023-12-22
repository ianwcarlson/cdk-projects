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
  LOG_GROUP_NAME,
  ORCHESTRATOR_SERVICE_NAME,
  PROCESS_ID,
  REGION,
  WORKER_IMAGE_NAME,
} from "../environment-variables";
import {
  ECS_TASK_STATE_RUNNING,
  createService,
  deleteService,
  findServiceByName,
  getTaskState,
  registerTaskDefinition,
} from "../lib/sdk-drivers/ecs/ecs-io";
import {
  createQueue,
  deleteQueue,
  listQueues,
  receiveMessage,
  sendMessageBatch,
} from "../lib/sdk-drivers/sqs/sqs-io";
import {
  getFailedValuesFromSettledPromises,
  getFulfilledValuesFromSettledPromises,
  groupArray,
  importRegionEnvVar,
  sleep,
  validateEnvVar,
} from "../utils";
import { AssignPublicIp, RunTaskCommandOutput } from "@aws-sdk/client-ecs";
import { CreateQueueCommandOutput, Message } from "@aws-sdk/client-sqs";
import { JobMessageBody, JobStatus, JobStatusMessageBody } from "./job-types";
import { LogBuffer } from "./log-buffer";

const region = importRegionEnvVar();
const group = validateEnvVar(ECS_GROUP);
const clusterArn = validateEnvVar(ECS_CLUSTER_ARN);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
// const workerTaskDefinitionArn = validateEnvVar(WORKER_TASK_DEF_ARN);
const batchParallelism = parseInt(validateEnvVar(BATCH_PARALLELISM));
const executionRoleArn = validateEnvVar(ECS_EXECUTION_ROLE_ARN);
const taskRoleArn = validateEnvVar(ECS_TASK_ROLE_ARN);
const workerImageName = validateEnvVar(WORKER_IMAGE_NAME);
const processId = validateEnvVar(PROCESS_ID);
const orchestratorServiceName = validateEnvVar(ORCHESTRATOR_SERVICE_NAME);
const logGroupName = validateEnvVar(LOG_GROUP_NAME);

const MAX_RETRY_COUNT = 1000;
const MAX_READ_STALL_COUNT = 10;
const MAX_WORKER_RETRY_COUNT = 2;
const WorkerMemoryMB = 1024;
const WorkerCpu = 512;

const log = new LogBuffer();

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

  const inputData = await handleGenerateInputData();
  try {
    const services = await setupPipeline(workerRunCommand);
    queueUrls = services.queueUrls;
    serviceArn = services.workerServiceArn;

    await writeBatches({
      inputData,
      workerQueueUrl: queueUrls.jobQueueUrl,
      workerStatusQueueUrl: queueUrls.jobStatusQueueUrl,
      jobProperties: {},
      handleJobStatusResponse,
    });
  } catch (e) {
    console.error("Encountered exception: ", e);
  } finally {
    await cleanUp({
      queueUrls: [queueUrls?.jobQueueUrl, queueUrls?.jobStatusQueueUrl],
      workerServiceArn: serviceArn,
    });
  }
}

async function setupPipeline(workerRunCommand: string[]) {
  log.log("orchestrator starting");

  const jobQueueName = `job-queue-${processId}`;
  const jobStatusQueueName = `job-status-queue-${processId}`;

  log.log("Creating job queue and response state queues");

  // Documentation says to wait at least a second, but starting tasks
  // should easily cover that
  const { jobQueueUrl, jobStatusQueueUrl } = await createQueues({
    jobQueueName,
    jobStatusQueueName,
  });

  log.log("Creating worker task definition");

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
          }
        ],
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

  log.log("Creating worker service");

  const createdService = await createService({
    clusterArn,
    serviceName: `batch-processor-worker-service-${processId}`,
    taskDefinitionArn:
      workerTaskDefinitionResponse.taskDefinition.taskDefinitionArn,
    desiredCount: batchParallelism,
    securityGroups: [securityGroupArn],
    subnets: [subnetArn],
    assignPublicIp: AssignPublicIp.ENABLED,
  });

  // const startedTasks = await startWorkerTasks({
  //   uniqueId,
  //   jobQueueUrl: queueUrls[0],
  //   jobStatusQueueUrl: queueUrls[1],
  //   workerRunCommand,
  // });

  // const taskArns = await extractTaskArns(startedTasks);

  // await waitForTasksRunning();

  return {
    queueUrls: { jobQueueUrl, jobStatusQueueUrl },
    workerServiceArn: createdService.service?.serviceArn,
  };
}

interface QueueTaskArns {
  queueUrls: (string | undefined)[];
  workerServiceArn: string | undefined;
}

async function cleanUp({ queueUrls, workerServiceArn }: QueueTaskArns) {
  log.log("Cleaning up");
  if (workerServiceArn) {
    await deleteService({
      serviceArn: workerServiceArn,
      clusterArn,
    });
  }

  await sleep(10000);

  for (const queueUrl of queueUrls) {
    if (queueUrl) {
      await deleteQueue(queueUrl);
    }
  }

  // temp
  const moreQueueUrls = await listQueues("job-");
  for (const queueUrl of moreQueueUrls) {
    if (queueUrl) {
      await deleteQueue(queueUrl);
    }
  }

  // And for my next trick, I will delete myself
  const orchestratorService = await findServiceByName({
    clusterArn,
    serviceName: orchestratorServiceName,
  });
  if (orchestratorService && orchestratorService.serviceArn) {
    await deleteService({
      serviceArn: orchestratorService.serviceArn,
      clusterArn,
    });
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
    console.log("createQueueResponses: ", JSON.stringify(createQueueResponses));
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

async function waitForTasksRunning({
  workerTaskDefinitionArn,
}: {
  workerTaskDefinitionArn: string;
}) {
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
  let readStallCounter = MAX_READ_STALL_COUNT;
  const workerPool: Map<
    number,
    { currentTime: Date; taskIds: (string | number)[]; retries: number }
  > = new Map();
  const batchParallelism = 6;
  const groupedInputData = groupArray(inputData, 10);
  const numBatches = groupedInputData.length;
  log.log("numBatches: " + numBatches);

  while (readBatchIdx < numBatches && readStallCounter > 0) {
    readStallCounter -= 1;
    log.log("readStallCounter: " + readStallCounter);
    log.log("readBatchIdx: " + readBatchIdx);
    log.log("writeBatchIdx: " + writeBatchIdx);
    if (workerPool.size < batchParallelism && readBatchIdx < numBatches) {
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
        console.log("workerPool yo: ", workerPool.entries());
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

      // console.log("messages: " + JSON.stringify(messages));

      for (const message of messages) {
        const { batchIndex, status } = message;
        console.log("batchIndex: ", batchIndex);
        console.log("status: ", status);
        console.log("workerPool: ", JSON.stringify(workerPool));
        const worker = workerPool.get(batchIndex);
        if (worker) {
          readBatchIdx = +1;
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
      // console.log("handleJobStatusResponse: " + handleJobStatusResponse);
      if (handleJobStatusResponse) {
        await handleJobStatusResponse(messages);
      }
    }
    // console.log("Donzo");
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
  let messages: Message[] = [];
  let retryCount = MAX_RETRY_COUNT;

  do {
    const { response: message, acknowledgeMessageReceived } =
      await receiveMessage({ queueUrl });
    // console.log("message: ", JSON.stringify(message));
    if (message && message.Messages) {
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
    family: `batch-processor-worker-task-${processId}`,
    executionRoleArn: executionRoleArn,
    taskRoleArn: taskRoleArn,
    containerDefinitions: [
      {
        name: `batch-processor-worker-container-${processId}`,
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

  if (
    !taskDefinition.taskDefinition ||
    !taskDefinition.taskDefinition.taskDefinitionArn
  ) {
    throw new Error(
      "Unable to create worker task definition: " +
        JSON.stringify(taskDefinition),
    );
  }

  const createdService = await createService({
    clusterArn,
    serviceName: `batch-processor-worker-service-${processId}`,
    taskDefinitionArn: taskDefinition.taskDefinition?.taskDefinitionArn,
    desiredCount: batchParallelism,
    securityGroups: [securityGroupArn],
    subnets: [subnetArn],
    assignPublicIp: AssignPublicIp.ENABLED,
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
  //       containerName: `batch-worker-${processId}-${startedTasks.length}`,
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
