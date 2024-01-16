import * as cdk from "aws-cdk-lib";
import {
  CfnNatGateway,
  PrivateSubnet,
  PublicSubnet,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { validateEnvVar } from "../../utils";
import { ACCOUNT, PARALLELISM, REGION } from "../../environment-variables";
import { MultiTenantQueueLambdaTop } from "./lambda-top";
import { HttpApiGatewayTop } from "./http-api-gateway-top";
import { FifoThroughputLimit, Queue } from "aws-cdk-lib/aws-sqs";
import { Stack, StackProps } from "aws-cdk-lib";

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const parallelism = parseInt(process.env[PARALLELISM] || "1");

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

    const queues = Array.from(Array(parallelism)).map((_, i) => {
      return new Queue(
        this,
        `MultiTenantQueue-${instanceId}-${i}}`,
        {
          queueName: `MultiTenantRoundRobinQueue-${instanceId}-${i}.fifo`,
          fifo: true,
          fifoThroughputLimit: FifoThroughputLimit.PER_QUEUE,
        },
      );
    });

    const highPriorityQueues = Array.from(Array(parallelism)).map((_, i) => {
      return new Queue(
        this,
        `MultiTenantQueue-${instanceId}-${i}}`,
        {
          queueName: `MultiTenantRoundRobinQueue-${instanceId}-${i}.fifo`,
          fifo: true,
          fifoThroughputLimit: FifoThroughputLimit.PER_QUEUE,
        },
      );
    });

    const multiTenantQueueLambdaTop = new MultiTenantQueueLambdaTop(
      this,
      `MultiTenantQueueLambdaTop-${instanceId}`,
      {
        instanceId,
        env: {
          region,
          account,
        },
        queueUrls: queues.map((queue) => queue.queueUrl),
        highPriorityQueueUrls: highPriorityQueues.map((queue) => queue.queueUrl),
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
