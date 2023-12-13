import { nanoid } from "nanoid";
import { ECS_CLUSTER_ARN, ECS_GROUP, ECS_SECURITY_GROUP_ARN, ECS_SUBNET_ARN, ORCHESTRATOR_TASK_DEF_ARN, REGION } from "../../environment-variables";
import { validateEnvVar } from "../../utils";
import { runTask } from "../sdk-drivers/ecs/ecs-io";

const region = validateEnvVar(REGION);
const cluster = validateEnvVar(ECS_CLUSTER_ARN);
const securityGroupArn = validateEnvVar(ECS_SECURITY_GROUP_ARN);
const subnetArn = validateEnvVar(ECS_SUBNET_ARN);
const taskDefinitionArn = validateEnvVar(ORCHESTRATOR_TASK_DEF_ARN);
const group = validateEnvVar(ECS_GROUP);

interface InputEvent {
  command?: string[];
}

export const handler = async (event: InputEvent) => {
  console.log("start-batch-processor: event", event);

  const { command } = event;

  await runTask({
    region,
    clusterArn: cluster,
    securityGroupArns: [securityGroupArn],
    taskDefinitionArn,
    group,
    subnetArns: [subnetArn  ],
    containerName: `batch-processor-orchestrator-${nanoid()}`,
    environment: {},
  })


}