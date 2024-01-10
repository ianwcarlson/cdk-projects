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

    const roundRobinQueue = new Queue(this, `Queue-${instanceId}`, {
      queueName: `RoundRobinQueue-${instanceId}`,
      fifo: true,
      fifoThroughputLimit: FifoThroughputLimit.PER_MESSAGE_GROUP_ID
    });

    const multiTenantQueueLambdaTop = new MultiTenantQueueLambdaTop(
      this,
      `MultiTenantQueueLambdaTop-${instanceId}`,
      {
        env: {
          region,
          account,
        },
      },
    );

    new HttpApiGatewayTop(this, `HttpApiGatewayTop-${instanceId}`, {
      apiDefaultHandlerLambda:
        multiTenantQueueLambdaTop.lambdas.apiDefaultHandler,
      env: {
        region,
        account,
      },
    });
  }
}
