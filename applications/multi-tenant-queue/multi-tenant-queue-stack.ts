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

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const instanceId = validateEnvVar(INSTANCE_ID);

export class MultiTenantQueueStack extends cdk.Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new MultiTenantQueueLambdaTop(
      this,
      `multi-tenant-queue-lambda-top-${instanceId}`,
      {
        env: {
          region,
          account,
        },
      },
    );
  }
}
