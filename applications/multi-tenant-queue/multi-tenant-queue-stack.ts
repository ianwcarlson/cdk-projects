import * as cdk from "aws-cdk-lib";
import {
  CfnNatGateway,
  PrivateSubnet,
  PublicSubnet,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { validateEnvVar } from "../../utils";
import { ACCOUNT, REGION } from "../../environment-variables";
import { MultiTenantQueueLambdaTop } from "./lambda-top";
import { HttpApiGatewayTop } from "./http-api-gateway-top";
import { FifoThroughputLimit, Queue } from "aws-cdk-lib/aws-sqs";
import { Stack, StackProps } from "aws-cdk-lib";

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);

interface MultiTenantQueueStackProps extends StackProps {
  instanceId: string;
}

export class MultiTenantQueueStack extends Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props: MultiTenantQueueStackProps) {
    super(scope, id, props);

    const { instanceId } = props;

    const roundRobinQueue = new Queue(
      this,
      `MultiTenantRoundRobinQueue-${instanceId}`,
      {
        queueName: `MultiTenantRoundRobinQueue-${instanceId}.fifo`,
        fifo: true,
        fifoThroughputLimit: FifoThroughputLimit.PER_QUEUE,
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
        billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    );

    const multiTenantQueueLambdaTop = new MultiTenantQueueLambdaTop(
      this,
      `MultiTenantQueueLambdaTop-${instanceId}`,
      {
        instanceId,
        env: {
          region,
          account,
        },
        roundRobinQueueUrl: roundRobinQueue.queueUrl,
        multiTenantTableName: multiTenantTable.tableName,
      },
    );

    new HttpApiGatewayTop(this, `MultiTenantHttpApiGatewayTop-${instanceId}`, {
      instanceId,
      apiDefaultHandlerLambda:
        multiTenantQueueLambdaTop.lambdas.apiDefaultHandler,
      env: {
        region,
        account,
      },
    });
  }
}
