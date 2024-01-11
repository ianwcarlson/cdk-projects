import * as cdk from "aws-cdk-lib";
import {
  CfnNatGateway,
  PrivateSubnet,
  PublicSubnet,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { validateEnvVar } from "../../utils";
import { ACCOUNT, INSTANCE_ID, REGION } from "../../environment-variables";
import { MultiTenantQueueLambdaTop } from "./lambda-top";
import { HttpApiGatewayTop } from "./http-api-gateway-top";
import { FifoThroughputLimit, Queue } from "aws-cdk-lib/aws-sqs";

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const instanceId = validateEnvVar(INSTANCE_ID);

export class MultiTenantQueueStack extends cdk.Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const roundRobinQueue = new Queue(
      this,
      `MultiTenantRoundRobinQueue-${instanceId}`,
      {
        queueName: `MultiTenantRoundRobinQueue-${instanceId}`,
        fifo: true,
        fifoThroughputLimit: FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      },
    );

    const multiTenantTable = new cdk.aws_dynamodb.Table(
      this,
      `MultiTenantTable-${instanceId}`,
      {
        partitionKey: {
          name: "tenantId",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "queueUrl",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    );

    const multiTenantQueueLambdaTop = new MultiTenantQueueLambdaTop(
      this,
      `MultiTenantQueueLambdaTop-${instanceId}`,
      {
        env: {
          region,
          account,
        },
        roundRobinQueueUrl: roundRobinQueue.queueUrl,
        multiTenantTableName: multiTenantTable.tableName,
      },
    );

    new HttpApiGatewayTop(this, `MultiTenantHttpApiGatewayTop-${instanceId}`, {
      apiDefaultHandlerLambda:
        multiTenantQueueLambdaTop.lambdas.apiDefaultHandler,
      env: {
        region,
        account,
      },
    });
  }
}
