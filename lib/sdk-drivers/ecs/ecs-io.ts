import {
  AssignPublicIp,
  ECSClient,
  LaunchType,
  RunTaskCommand,
  ListTaskDefinitionsCommand,
  DescribeTasksCommand,
  ListClustersCommand,
  ListClustersCommandInput,
  DescribeClustersCommand,
  StopTaskCommand,
  RegisterTaskDefinitionCommand,
  CreateServiceCommand,
  DeregisterTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import { importRegionEnvVar, sleep } from "../../../utils";
import { DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { sqsClient } from "../sqs/sqs-client";
import { ecsClient } from "./ecs-client";
import { availableParallelism } from "os";

const RETRY_WAIT_MS = 200;
export const ECS_TASK_STATE_STOPPED = "STOPPED";
export const ECS_TASK_STATE_RUNNING = "RUNNING";

const region = importRegionEnvVar();

interface RunTaskInput {
  region: string;
  clusterArn: string;
  count?: number;
  group: string;
  securityGroupArns: Array<string>;
  subnetArns: Array<string>;
  taskDefinitionArn: string;
  containerName: string;
  environment: { [key: string]: string };
  command?: Array<string>;
}

export async function runTask({
  region,
  clusterArn,
  count = 1,
  group,
  securityGroupArns,
  subnetArns,
  taskDefinitionArn,
  containerName,
  environment = {},
  command,
}: RunTaskInput) {
  const client = new ECSClient({ region });

  const adaptedEnvironment = Object.keys(environment).map((k) => {
    return {
      name: k,
      value: environment[k],
    };
  });

  console.log(
    "Running task with the following environment variables: " +
      JSON.stringify(adaptedEnvironment),
  );

  const containerOverride: {
    name: string;
    environment: Array<{ name: string; value: string }>;
    command?: Array<string>;
  } = {
    name: containerName,
    environment: adaptedEnvironment,
  };
  if (command) {
    containerOverride.command = command;
    console.log("ECS run task command override: " + JSON.stringify(command));
  }

  const input = {
    cluster: clusterArn,
    count,
    group,
    launchType: LaunchType.FARGATE,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: AssignPublicIp.DISABLED,
        securityGroups: securityGroupArns,
        subnets: subnetArns,
      },
    },
    taskDefinition: taskDefinitionArn,
    overrides: {
      containerOverrides: [containerOverride],
    },
  };
  const runTaskCommand = new RunTaskCommand(input);
  return await client.send(runTaskCommand);
}

interface StopTaskInput {
  region: string;
  taskArn: string;
  clusterArn?: string;
  reason?: string;
}

export async function stopTask({
  region,
  taskArn,
  reason = "",
  clusterArn,
}: StopTaskInput) {
  const client = new ECSClient({ region });
  const input = {
    task: taskArn,
    reason,
    cluster: clusterArn,
  };
  const command = new StopTaskCommand(input);
  const response = await client.send(command);
  console.log("Stop task response: " + JSON.stringify(response));
  return response;
}

export async function listTaskDefinitions({
  region,
  family,
}: {
  region: string;
  family: string;
}) {
  const client = new ECSClient({ region });

  console.log(
    `Listing task definitions for region ${region} and family: ${family}`,
  );

  const input = {
    familyPrefix: family,
  };
  const command = new ListTaskDefinitionsCommand(input);
  const response = await client.send(command);
  return response.taskDefinitionArns;
}

export async function listClusters({ region }: { region: string }) {
  let nextToken;
  let retryCount = 100;
  let clusterArns: string[] = [];
  while (retryCount > 0) {
    retryCount -= 1;
    const client = new ECSClient({ region });
    const input: ListClustersCommandInput = { nextToken };
    const command = new ListClustersCommand(input);
    const response = await client.send(command);
    clusterArns = clusterArns.concat(response.clusterArns || []);
    nextToken = response.nextToken;
    if (!nextToken) {
      break;
    }
  }
  if (retryCount === 0) {
    const message = `Unable to read all paginated clusters for ${region}`;
    console.error(message);
    throw new Error(message);
  }

  return clusterArns;
}

export async function describeClusters({
  region,
  clusterArns,
}: {
  region: string;
  clusterArns: string[];
}) {
  const client = new ECSClient({ region });
  const input = {
    clusters: clusterArns,
  };
  const command = new DescribeClustersCommand(input);
  return await client.send(command);
}

export async function describeTasks({
  region,
  taskArns,
  clusterArn,
}: {
  region: string;
  taskArns: string[];
  clusterArn: string;
}) {
  const client = new ECSClient({ region });
  const input = {
    cluster: clusterArn,
    tasks: taskArns,
  };
  const command = new DescribeTasksCommand(input);
  return await client.send(command);
}

interface GetTaskStateInput {
  clusterArn: string;
  taskArn: string;
}

export async function getTaskState({ clusterArn, taskArn }: GetTaskStateInput) {
  const response = await describeTasks({
    region,
    // findEcsClusterArn should throw exception if cluster not found
    // so the default "" here is just for typescript
    clusterArn,
    taskArns: [taskArn],
  });
  if (response.failures && response.failures.length > 0) {
    const errorMessage = `Deploy Task Failures detected:\n ${response.failures.join(
      "\n ",
    )}`;
    console.error(errorMessage);
  }
  return response;
}

interface WaitForTaskToCompleteInput {
  region: string;
  taskArn: string;
  clusterArn: string;
  clusterName: string;
  instanceId: string;
  desiredState: typeof ECS_TASK_STATE_RUNNING | typeof ECS_TASK_STATE_STOPPED;
}

async function waitForTaskState({
  taskArn,
  clusterName,
  clusterArn,
  instanceId,
  desiredState,
}: WaitForTaskToCompleteInput) {
  const foundCluster = await findEcsClusterArn(clusterName);

  let retryCount = 1000;
  while (retryCount > 0) {
    retryCount -= 1;

    const response = await getTaskState({ clusterArn, taskArn });

    if (response.tasks && retryCount % 12 === 0) {
      console.log(
        "Waiting for cdk deploy comment to finish in " +
          instanceId +
          ". Current state is " +
          response.tasks[0].lastStatus,
      );
    }

    if (response.tasks && response.tasks[0].lastStatus === desiredState) {
      console.log(
        `Task ARN ${taskArn} in ${instanceId} is ${desiredState}. Proceeding...\nLast status ${response.tasks[0].lastStatus}`,
      );
      break;
    }

    await sleep(RETRY_WAIT_MS);
  }

  if (retryCount === 0) {
    const errorMessage = `Retry limit reached at ${new Date().toTimeString()}. Deploy Task never completed in ${instanceId}.`;
    console.error(errorMessage);
    return;
  }
}

export async function findEcsClusterArn(clusterName: string) {
  const clusterArns = await listClusters({ region });
  const describedClusters = await describeClusters({ region, clusterArns });
  const foundCluster = (describedClusters.clusters || []).find(
    (c) => c.clusterName && c.clusterName.includes(clusterName),
  );
  if (!foundCluster) {
    const errorMessage = `Unable to find cluster: ${clusterName}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  } else {
    console.log("Found cluster " + foundCluster.clusterName);
  }
  return foundCluster;
}

interface RegisterTaskDefinitionInput {
  family: string;
  taskRoleArn: string;
  executionRoleArn: string;
  containerDefinitions: Array<{
    name: string;
    image: string;
    environment: Array<{ name: string; value: string }>;
    command?: Array<string>;
    cpu: number;
    memory: number;
  }>;
  ephemeralStorage?: {
    sizeInGiB: number;
  };
  runtimePlatform?: {
    cpuArchitecture: string;
    operatingSystem: string;
  };
}

export async function registerTaskDefinition({
  family,
  containerDefinitions,
}: RegisterTaskDefinitionInput) {
  const input = {
    family,
    containerDefinitions,
  };
  const command = new RegisterTaskDefinitionCommand(input);
  return await ecsClient.send(command);
}

interface DeregisterTaskDefinitionCommandInput {
  taskDefinitionArn: string;
}

export async function deregisterTaskDefinitions({
  taskDefinitionArn,
}: DeregisterTaskDefinitionCommandInput) {
  const input = {
    taskDefinition: taskDefinitionArn,
  };
  const command = new DeregisterTaskDefinitionCommand(input);
}

interface CreateServiceInput {
  clusterArn: string;
  serviceName: string;
  taskDefinitionArn: string;
  desiredCount: number;
  launchType?: LaunchType;
  securityGroups: Array<string>;
  subnets: Array<string>;
  healthCheckGracePeriodSeconds?: number;
}

export async function createService({
  clusterArn,
  serviceName,
  taskDefinitionArn,
  desiredCount,
  launchType = LaunchType.FARGATE,
  securityGroups,
  subnets,
  healthCheckGracePeriodSeconds = 90,
}: CreateServiceInput) {
  const input = {
    cluster: clusterArn,
    serviceName,
    taskDefinition: taskDefinitionArn,
    desiredCount,
    LaunchType: launchType,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: AssignPublicIp.DISABLED,
        securityGroups,
        subnets,
      },
    },
    healthCheckGracePeriodSeconds,
  };
  const command = new CreateServiceCommand(input);
  return await ecsClient.send(command);
}

interface DeleteServiceInput {
  serviceArn: string;
  clusterArn: string;
}

export async function deleteService({
  serviceArn,
  clusterArn,
}: DeleteServiceInput) {
  const input = {
    service: serviceArn,
    cluster: clusterArn,
    force: true,
  };
}
