import { Duration, Size, NestedStack, StackProps, aws_iam } from "aws-cdk-lib";
import { NodejsFunction, SourceMapMode } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import {
  INSTANCE_ID,
  MULTI_TENANT_TABLE_NAME,
  REGION,
  ROUND_ROBIN_QUEUE_URL,
} from "../../environment-variables";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";

interface CreateLambdaInput {
  id: string;
  description: string;
  timeout?: Duration;
  memoryMB?: number;
  diskMB?: number;
  environment?: { [key: string]: string };
  maxConcurrency?: number;
}

interface MultiTenantQueueLambdaTopProps extends StackProps {
  instanceId: string;
  roundRobinQueueUrl: string;
  multiTenantTableName: string;
}

export class MultiTenantQueueLambdaTop extends NestedStack {
  public lambdas: { [key: string]: NodejsFunction } = {};
  private createLambda: (args: CreateLambdaInput) => NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: MultiTenantQueueLambdaTopProps,
  ) {
    super(scope, id, props);

    const { instanceId, roundRobinQueueUrl, multiTenantTableName } = props;
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
              `arn:aws:dynamodb:${region}:${account}:table/MultiTenant*`,
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
              "sqs:sendmessage",
              "sqs:listqueues",
              "sqs:createqueue",
              "sqs:purgequeue",
              "sqs:deletequeue",
              "sqs:sendmessage",
              "sqs:receivemessage",
              "kms:Encrypt",
              "kms:Decrypt",
              "logs:Put*",
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
      `LambdaExecutionRole-${instanceId}`,
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
        [INSTANCE_ID]: instanceId,
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
          loader: {
            // Include the api spec in the bundle
            ".yaml": "file",
          },
        },
      });
    };

    this.lambdas.apiDefaultHandler = this.createLambda({
      id: "api-default-handler",
      description: "Default API Handler",
      environment: {
        [ROUND_ROBIN_QUEUE_URL]: roundRobinQueueUrl,
        [MULTI_TENANT_TABLE_NAME]: multiTenantTableName,
      },
    });
  }
}
