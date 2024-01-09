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

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const instanceId = validateEnvVar(INSTANCE_ID);

export class MultiTenantQueueStack extends cdk.Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const apiDefaultHandlerLambda = new MultiTenantQueueLambdaTop(
      this,
      `MultiTenantQueueLambdaTop-${instanceId}`,
      {
        env: {
          region,
          account,
        },
      },
    );

    const apiIntegration = new HttpLambdaIntegration(
      "ApiDefaultHandlerLambda",
      apiDefaultHandlerLambda.lambdas.apiDefaultHandler,
    );

    const httpApi = new HttpApi(this, "HttpApi");

    // We need to add each path separately, even though they're mapped to the same lambda,
    // because api-gateway won't parse the path params correctly otherwise.
    httpApi.addRoutes({
      path: "/user",
      methods: [
        HttpMethod.ANY,
      ],
      integration: apiIntegration,
    });
    httpApi.addRoutes({
      path: "/user/{userId}",
      methods: [
        HttpMethod.ANY,
      ],
      integration: apiIntegration,
    });
  }
}
