import { Duration, Size, aws_iam, NestedStack } from "aws-cdk-lib";
import { NodejsFunction, SourceMapMode } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import {
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_GROUP,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  ORCHESTRATOR_TASK_DEF_ARN,
  REGION,
} from "../../environment-variables";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { BatchProcessorLambdaTopProps } from "../../cdk-types";

interface CreateLambdaInput {
  id: string;
  description: string;
  timeout?: Duration;
  memoryMB?: number;
  diskMB?: number;
  environment?: { [key: string]: string };
  maxConcurrency?: number;
}

export class BatchProcessorLambdaTop extends NestedStack {
  public lambdas: { [key: string]: NodejsFunction } = {};
  private createLambda: (args: CreateLambdaInput) => NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: BatchProcessorLambdaTopProps,
  ) {
    super(scope, id, props);

    const region = props.env?.region || "";
    const account = props.env?.account || "";

    const inlinePolicies = {
      defaultPolicy: new aws_iam.PolicyDocument({
        statements: [
          new aws_iam.PolicyStatement({
            actions: ["ssm:GetParameter"],
            principals: [],
            resources: [`arn:aws:ssm:${region}:${account}:parameter/*`],
          }),
          new aws_iam.PolicyStatement({
            actions: ["cognito-idp:DescribeUserPoolClient"],
            principals: [],
            resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/*`],
          }),
          new aws_iam.PolicyStatement({
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem",
            ],
            principals: [],
            resources: [
              `arn:aws:dynamodb:${region}:${account}:table/DynamoTop*`,
            ],
          }),
          new aws_iam.PolicyStatement({
            actions: [
              "s3:Get*",
              "s3:Put*",
              "s3:List*",
              "s3:Describe*",
              "s3:Delete*",
            ],
            principals: [],
            resources: [`*`],
          }),
          new aws_iam.PolicyStatement({
            actions: [
              "iam:CreateRole",
              "iam:TagRole",
              "iam:PassRole",
              "lambda:GetFunction",
              "lambda:CreateFunction",
              "lambda:TagResource",
              "lambda:InvokeFunction",
              "scheduler:CreateSchedule",
              "logs:PutSubscriptionFilter",
              "logs:PutRetentionPolicy",
              "logs:DescribeLogGroups",
              "sqs:sendmessage",
              "kms:Encrypt",
              "kms:Decrypt",
              "ecs:RunTask",
              "ecs:StartTask",
              "ecs:StopTask",
              "ecs:ListTasks",
              "ecs:DescribeTasks",
              "ecs:DescribeContainerInstances",
              "ecs:DescribeTaskDefinition",
              "ecs:ListTaskDefinitions",
              "ecs:CreateService",
              "ecs:RegisterTaskDefinition",
            ],
            principals: [],
            resources: [`*`],
          }),
        ],
      }),
    };

    const managedPolicies = [
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    ];

    const defaultExecutionRole = new aws_iam.Role(
      this,
      "lambda-execution-role",
      {
        assumedBy: new aws_iam.CompositePrincipal(
          new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
        ),
        inlinePolicies,
        managedPolicies,
      },
    );

    this.createLambda = ({
      id,
      description,
      timeout = Duration.minutes(3),
      environment = {},
      memoryMB = 512,
      diskMB = 512,
      maxConcurrency = 10,
    }: CreateLambdaInput) => {
      const defaultEnvironment = {
        [REGION]: region,
      };
      const combinedEnvironment = {
        ...defaultEnvironment,
        ...environment,
      };
      return new NodejsFunction(this, id, {
        description,
        logRetention: RetentionDays.FIVE_DAYS,
        timeout,
        retryAttempts: 0,
        memorySize: memoryMB,
        ephemeralStorageSize: Size.mebibytes(diskMB),
        reservedConcurrentExecutions: maxConcurrency,
        environment: combinedEnvironment,
        role: defaultExecutionRole,
        bundling: {
          minify: false, // minify code, defaults to false
          sourceMap: true, // include source map, defaults to false
          sourceMapMode: SourceMapMode.INLINE, // defaults to SourceMapMode.DEFAULT
          sourcesContent: true,
        },
      });
    };

    this.lambdas.startBatchProcessor = this.createLambda({
      id: "start-batch-processor",
      description:
        "Starts the orchestrator which will start the batch processor",
      environment: {
        [ECS_CLUSTER_ARN]: props.cluster.clusterArn,
        [ECS_SECURITY_GROUP_ARN]: props.noIngressSecurityGroup.securityGroupId,
        [ECS_SUBNET_ARN]: props.publicSubnet.subnetId,
        [ECS_TASK_ROLE_ARN]: props.taskRoleArn,
        [ECS_EXECUTION_ROLE_ARN]: props.taskRoleArn,
        [ECS_GROUP]: props.batchProcessorEcsGroup,
      },
    });
  }
}
