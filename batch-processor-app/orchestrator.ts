import { nanoid } from "nanoid";

import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_GROUP,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_DEF_ARN,
} from "../environment-variables";
import { ECS_TASK_STATE_RUNNING, deleteQueue, findEcsClusterArn, getTaskState, runTask, stopTask } from "../lib/sdk-drivers/ecs/ecs-io";
import { createQueue } from "../lib/sdk-drivers/sqs/sqs-io";
import { importRegionEnvVar, sleep, validateEnvVar } from "../utils";
import { RunTaskCommandOutput } from "@aws-sdk/client-ecs";

const region = importRegionEnvVar();
const clusterArn = validateEnvVar(ECS_CLUSTER_ARN);
const group = validateEnvVar(ECS_GROUP);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const taskDefinitionArn = validateEnvVar(ECS_TASK_DEF_ARN);
const batchParallelism = validateEnvVar(BATCH_PARALLELISM);

const MAX_RETRY_COUNT = 1000;

interface QueueTaskArns {
  queueUrls: string[],
  taskArns: string[]
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
    })
    const taskStates = await Promise.all(getTaskStatePromises);
    areAllTasksRunning = taskStates.every(ts => ts.tasks && ts.tasks[0].lastStatus === ECS_TASK_STATE_RUNNING)
    retryCount -= 1; 
    await sleep(500);
  } while (retryCount < MAX_RETRY_COUNT && !areAllTasksRunning)

  if (retryCount === 0) {
    const errorMessage = `Unable to start ${batchParallelism} tasks in RUNNING state`;
    console.log(errorMessage)
    throw new Error(errorMessage)
  }

  const taskArns = startedTasks.reduce((acc: string[], t: RunTaskCommandOutput) => {
    if (t.tasks && t.tasks.length > 0 && t.tasks[0].taskArn) {
      acc.push(t.tasks[0].taskArn);
    }
    return acc;
  }, []);

  const queueUrls = createQueueResponses.reduce((acc: string[], r) => {
    if (r.QueueUrl) {
      acc.push(r.QueueUrl);
    }
    return acc;
  }, []);

  return { queueUrls, taskArns };
}

async function cleanUp({ queueUrls , taskArns }: QueueTaskArns) {
  for (const taskArn of taskArns) {
    await stopTask({ region, taskArn, reason: "Cleaning up batch-processing tasks", clusterArn });
  }
  for (const queueUrl of queueUrls) {
    await deleteQueue(queueUrl);
  }
}

orchestrator().then();
