import { AssignPublicIp } from "@aws-sdk/client-ecs";
import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_GROUP,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  LOG_GROUP_NAME,
  ORCHESTRATOR_SERVICE_NAME,
  ORCHESTRATOR_TASK_DEFINITION_ARN,
  PROCESS_ID,
  REGION,
  WORKER_IMAGE_NAME,
} from "../../environment-variables";
import { validateEnvVar } from "../../utils";
import {
  createService,
  registerTaskDefinition,
  runTask,
} from "../sdk-drivers/ecs/ecs-io";
import {
  createLogGroup,
  describeLogGroups,
} from "../sdk-drivers/cloudwatch/cloudwatch-io";

const region = validateEnvVar(REGION);
const cluster = validateEnvVar(ECS_CLUSTER_ARN);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const executionRoleArn = validateEnvVar(ECS_EXECUTION_ROLE_ARN);
const taskRoleArn = validateEnvVar(ECS_TASK_ROLE_ARN);
const group = validateEnvVar(ECS_GROUP);
const orchestratorTaskDefinitionArn = validateEnvVar(
  ORCHESTRATOR_TASK_DEFINITION_ARN,
);

const LogGroupName = "/aws/batch-processor";
const WorkerImageName = "ianwcarlson/batch-processor:latest";

interface InputEvent {
  command?: string[];
  numWorkers?: number;
}

export const handler = async (event: InputEvent) => {
  console.log("start-batch-processor: event", event);

  console.log(`Creating log group ${LogGroupName}`);

  // millisecond precision should be good enough
  const processId = new Date().toISOString().replace(/[:.]/g, "-");
  const orchestratorServiceName = `batch-processor-orchestrator-${processId}`;

  const logGroups = await describeLogGroups({
    logGroupNamePattern: LogGroupName,
  });
  if (logGroups.logGroups && logGroups.logGroups.length === 0) {
    await createLogGroup(LogGroupName);
  }

  /**
   * So it turns out we need to dynamically create the service so that a public
   * ip address can be assigned, which is required for internet access. Therefore,
   * this lambda will create a service with a desired count of 1. The service will
   * take ownership of the running task. If we just run the task outside of a service,
   * it seems like the public ip doesn't get assigned.
   *
   * Deleting the service is a little trickier. We can have the orchestrator send a message
   * to SNS which has a subscribed lambda handler that will clean up the service and
   * everything else that's created as run time. Probably don't want the orchestrator
   * to delete itself synchronously.
   */

  async function createTaskDefinition({
    command,
    memory,
    cpu,
    environment = [],
    entryPoint = ["sh", "-c"],
  }: {
    command: string[];
    memory: number;
    cpu: number;
    environment?: { name: string; value: string }[];
    entryPoint?: string[];
  }) {
    return registerTaskDefinition({
      family: group,
      taskRoleArn,
      executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      memory: memory.toString(),
      cpu: cpu.toString(),
      containerDefinitions: [
        {
          name: group,
          image: WorkerImageName,
          command,
          entryPoint,
          cpu,
          memory,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": LogGroupName,
              "awslogs-region": region,
              "awslogs-stream-prefix": "orchestrator",
            },
          },
          environment: [
            {
              name: REGION,
              value: region,
            },
            {
              name: LOG_GROUP_NAME,
              value: LogGroupName,
            },
            {
              name: ECS_CLUSTER_ARN,
              value: cluster,
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
              name: ECS_GROUP,
              value: group,
            },
            {
              name: ECS_EXECUTION_ROLE_ARN,
              value: executionRoleArn,
            },
            {
              name: ECS_TASK_ROLE_ARN,
              value: taskRoleArn,
            },
            ...environment,
          ],
        },
      ],
    });
  }

  // const workerTaskDefinitionResponse = await createTaskDefinition({
  //   command: ["node worker-example.js"],
  //   cpu: 1024,
  //   memory: 2048,
  // });

  // if (!workerTaskDefinitionResponse.taskDefinition?.taskDefinitionArn) {
  //   throw new Error("Unable to create orchestrator task definition");
  // }

  // const orchestratorTaskDefinitionResponse = await createTaskDefinition({
  //   command: ["node orchestrator-example.js"],
  //   cpu: 512,
  //   memory: 1024,
  //   environment: [
  //     // {
  //     //   name: WORKER_TASK_DEF_ARN,
  //     //   value: workerTaskDefinitionResponse.taskDefinition?.taskDefinitionArn,
  //     // },
  //     {
  //       name: BATCH_PARALLELISM,
  //       value: event.numWorkers?.toString() || "1",
  //     },
  //     {
  //       name: WORKER_IMAGE_NAME,
  //       value: WorkerImageName,
  //     },
  //     {
  //       name: PROCESS_ID,
  //       value: processId,
  //     },
  //     {
  //       name: ORCHESTRATOR_SERVICE_NAME,
  //       value: orchestratorServiceName,
  //     },
  //   ],
  // });

  // if (!orchestratorTaskDefinitionResponse.taskDefinition?.taskDefinitionArn) {
  //   throw new Error("Unable to create orchestrator task definition");
  // }

  // await createService({
  //   serviceName: orchestratorServiceName,
  //   desiredCount: 1,
  //   clusterArn: cluster,
  //   securityGroups: [securityGroupArn],
  //   taskDefinitionArn:
  //     orchestratorTaskDefinitionResponse.taskDefinition.taskDefinitionArn,
  //   subnets: [subnetArn],
  //   assignPublicIp: AssignPublicIp.ENABLED,
  // });

  await runTask({
    region,
    clusterArn: cluster,
    securityGroupArns: [securityGroupArn],
    taskDefinitionArn: orchestratorTaskDefinitionArn,
    group,
    subnetArns: [subnetArn],
    containerName: group,
    environment: {
      [BATCH_PARALLELISM]: event.numWorkers?.toString() || "1",
      [REGION]: region,
      [LOG_GROUP_NAME]: LogGroupName,
      [ECS_CLUSTER_ARN]: cluster,
      [ECS_SECURITY_GROUP_ARN]: securityGroupArn,
      [ECS_SUBNET_ARN]: subnetArn,
      [ECS_GROUP]: group,
      [ECS_EXECUTION_ROLE_ARN]: executionRoleArn,
      [ECS_TASK_ROLE_ARN]: taskRoleArn,
    },
  });
};
