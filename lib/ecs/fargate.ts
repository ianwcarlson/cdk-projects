import { aws_ecs, Duration, NestedStack, Size } from "aws-cdk-lib";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { ISubnet, IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Role } from "aws-cdk-lib/aws-iam";
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { FargateProps } from "../../cdk-types";
import {
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  INSTANCE_ID,
  REGION,
  WORKER_IMAGE_NAME,
} from "../../environment-variables";
import { validateEnvVar } from "../../utils";
import { DOCKERHUB_SECRET_NAME } from "../../config/common-config";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
} from "aws-cdk-lib/aws-ecs";

const instanceId = validateEnvVar(INSTANCE_ID);

const orchestratorImageName = "ianwcarlson/batch-processor:latest";
const workerImageName = "ianwcarlson/batch-processor:latest";

interface FargateServiceConfigInterface {
  Cpu: number;
  MemoryMB: number;
  Command?: Array<string>;
  EntryPoint?: Array<string>;
  ScalingPolicy?: {
    ScaleOnMetric?: Metric;
    CapacityMax: number;
    CapacityIdle: number;
  };
  Image: string;
  ServicePrefixId: string;
  DesiredCount?: number;
  environment?: {
    [key: string]: string;
  };
  secrets?: {
    [key: string]: aws_ecs.Secret;
  };
}

export class FargateStack extends NestedStack {
  private dockerHubSecret: ISecret;
  private cluster: aws_ecs.Cluster;
  private contextId: string;
  private fargateExecutionRole: Role;
  private fargateTaskRole: Role;
  private noIngressSecurityGroup: SecurityGroup;
  private publicSubnet: ISubnet;
  public region: string;
  private logGroup: LogGroup;
  public orchestratorTaskDefinition: FargateTaskDefinition;
  public batchProcessorEcsGroup: string;

  constructor(scope: Construct, id: string, props: FargateProps) {
    super(scope, id, props);

    const {
      publicSubnet,
      cluster,
      fargateExecutionRole,
      fargateTaskRole,
      noIngressSecurityGroup,
      logGroup,
      env: { region },
    } = props;

    this.cluster = cluster;
    this.fargateTaskRole = fargateTaskRole;
    this.fargateExecutionRole = fargateExecutionRole;
    this.noIngressSecurityGroup = noIngressSecurityGroup;
    this.publicSubnet = publicSubnet;
    this.region = region;
    this.logGroup = logGroup;

    // this.dockerHubSecret = Secret.fromSecretCompleteArn(
    //   scope,
    //   "dockerhub-secret",
    //   "arn:aws:secretsmanager:us-west-1:264099909671:secret:dockerhub-credentials-gBJwvy",
    // );

    const Orchestrator: FargateServiceConfigInterface = {
      Cpu: 1024,
      MemoryMB: 2048,
      // Run the scanner inside a running ecs task. We don't really know how long the scan
      // will take, so we can't use lambda.
      Command: [`bash run-batch-processor-ochestration.sh`],
      EntryPoint: ["sh", "-c"],
      // We only run this on-demand
      DesiredCount: 0,
      ServicePrefixId: "batch-processor-orchestrator",
      Image: orchestratorImageName,
      environment: {
        [WORKER_IMAGE_NAME]: workerImageName,
      },
      secrets: {
        // GENERIC_API_TOKEN: aws_ecs.Secret.fromSecretsManager(
        //   this.genericApiToken,
        //   "token",
        // ),
      },
    };

    // Worker task definition is created dynamically in the orchestrator task

    const { taskDefinition } = this.instantiateFargateService({ params: Orchestrator });
    this.orchestratorTaskDefinition = taskDefinition;
    this.batchProcessorEcsGroup = Orchestrator.ServicePrefixId;
  }

  private instantiateFargateService = ({
    params,
  }: {
    params: FargateServiceConfigInterface;
  }) => {
    console.log("role: " + this.fargateTaskRole);
    //   cpu: params.Cpu,
    //   memoryLimitMiB: params.MemoryMB,
    //   executionRole: this.fargateExecutionRole,
    //   taskRole: this.fargateTaskRole,
    //   family: params.ServicePrefixId,
    // }));

    const taskDefinition = new FargateTaskDefinition(
      this,
      `task-${params.ServicePrefixId}`,
      {
        cpu: params.Cpu,
        memoryLimitMiB: params.MemoryMB,
        executionRole: this.fargateExecutionRole,
        taskRole: this.fargateTaskRole,
        family: params.ServicePrefixId,
      },
    );

    const fargateContainerProps = {
      image: ContainerImage.fromRegistry(params.Image), // {
      //  credentials: this.dockerHubSecret,
      //}),
      cpu: params.Cpu,
      memoryLimitMiB: params.MemoryMB,
      startTimeout: Duration.seconds(360),
      stopTimeout: Duration.seconds(60),
      command: params.Command,
      entryPoint: params.EntryPoint,
      // referencesSecretJsonField: true,
      ...this.overlayCommonFargateTaskProps(params),
    };

    const containerDefinition = taskDefinition.addContainer(
      params.ServicePrefixId, // TBD
      fargateContainerProps,
    );

    const configBase = {
      cluster: this.cluster,
      taskDefinition,
      // We need to assign a public IP so that the container can access the internet
      // The security group is set to no ingress, so it's not a security risk
      assignPublicIp: true,
      vpcSubnets: {
        subnets: [this.publicSubnet],
      },
      securityGroups: [this.noIngressSecurityGroup],
    };

    // Generally if fargate service doesn't have a scaling policy, it will stay at the
    // desired count.
    const fargateServiceConfig = Number.isNaN(params.DesiredCount)
      ? configBase
      : { ...configBase, desiredCount: params.DesiredCount };

    const service = new FargateService(
      this,
      `${params.ServicePrefixId}-${this.contextId}-service`,
      fargateServiceConfig,
    );

    return { taskDefinition, service };
  };

  private overlayCommonFargateTaskProps = (
    params: FargateServiceConfigInterface,
  ) => {
    return {
      secrets: {
        ...params.secrets,
      },
      environment: {
        SERVICE_PREFIX_ID: params.ServicePrefixId,
        [REGION]: this.region,

        [ECS_CLUSTER_ARN]: this.cluster.clusterArn,
        [ECS_SECURITY_GROUP_ARN]: this.noIngressSecurityGroup.securityGroupId,
        [ECS_SUBNET_ARN]: this.publicSubnet.subnetId,
        [ECS_TASK_ROLE_ARN]: this.fargateTaskRole.roleArn,
        [ECS_EXECUTION_ROLE_ARN]: this.fargateExecutionRole.roleArn,

        ...params.environment,
      },
      logging: aws_ecs.LogDriver.awsLogs({
        streamPrefix: "batch-processor",
        logGroup: this.logGroup,
      }),
    };
  };
}
