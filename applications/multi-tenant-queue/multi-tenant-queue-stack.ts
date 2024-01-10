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
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpApiGatewayTop } from "./http-api-gateway-top";

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const instanceId = validateEnvVar(INSTANCE_ID);

export class MultiTenantQueueStack extends cdk.Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
