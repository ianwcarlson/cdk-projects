import { aws_ecs, Duration, NestedStack, Size } from "aws-cdk-lib";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { ISubnet, IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Role } from "aws-cdk-lib/aws-iam";
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { FargateProps } from "../../cdk-types";
import { INSTANCE_ID } from "../../environment-variables";
import { validateEnvVar } from "../../utils";
import { DOCKERHUB_SECRET_NAME } from "../../config/common-config";
import { LogGroup } from "aws-cdk-lib/aws-logs";

const instanceId = validateEnvVar(INSTANCE_ID);

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
  private vpc: IVpc;
  private dockerHubSecret: ISecret;
  private cluster: aws_ecs.Cluster;
  private contextId: string;
  private fargateExecutionRole: Role;
  private fargateTaskRole: Role;
  private noIngressSecurityGroup: SecurityGroup;
  private publicSubnet: ISubnet;
  private dockerhubSecret: ISecret;
  public region: string;
  private logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: FargateProps) {
    super(scope, id, props);

    const {
      publicSubnet,
      vpc,
      cluster,
      fargateExecutionRole,
      fargateTaskRole,
      noIngressSecurityGroup,
      logGroup,
      env: { region },
    } = props;

    this.vpc = vpc;
    this.cluster = cluster;
    this.fargateTaskRole = fargateTaskRole;
    this.fargateExecutionRole = fargateExecutionRole;
    this.noIngressSecurityGroup = noIngressSecurityGroup;
    this.publicSubnet = publicSubnet;
    this.region = region;
    this.logGroup = logGroup;

    this.dockerhubSecret = Secret.fromSecretNameV2(
      scope,
      `dockerhub-secret-${instanceId}`,
      DOCKERHUB_SECRET_NAME,
    );

    const Orchestrator: FargateServiceConfigInterface = {
      Cpu: 1024,
      MemoryMB: 2048,
      // Run the scanner inside a running ecs task. We don't really know how long the scan
      // will take, so we can't use lambda.
      Command: [`bash run-batch-processor-ochestration.sh`],
      EntryPoint: ["sh", "-c"],
      // We only run this on-demand
      DesiredCount: 0,
      ServicePrefixId: "tbd",
      Image: "node:20",
      environment: {},
      secrets: {
        // GENERIC_API_TOKEN: aws_ecs.Secret.fromSecretsManager(
        //   this.genericApiToken,
        //   "token",
        // ),
      },
    };

    this.instantiateFargateService({ params: Orchestrator });
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

    const taskDefinition = new aws_ecs.FargateTaskDefinition(
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
      image: aws_ecs.ContainerImage.fromRegistry(params.Image, {
        credentials: this.dockerHubSecret,
      }),
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
      "containerName", // TBD
      fargateContainerProps,
    );

    const configBase = {
      cluster: this.cluster,
      taskDefinition,
      assignPublicIp: false,
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
    const service = new aws_ecs.FargateService(
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
        CONTEXT_ID: this.contextId,
        REGION: this.region,

        ECS_CLUSTER: this.cluster.clusterArn,
        ECS_SECURITY_GROUP: this.noIngressSecurityGroup.securityGroupId,
        ECS_SUBNET: this.publicSubnet.subnetId,

        ...params.environment,
      },
      logging: aws_ecs.LogDriver.awsLogs({
        streamPrefix: "batch-processor",
        logGroup: this.logGroup,
      }),
    };
  };
}
