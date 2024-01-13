import { NestedStack, StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

interface HttpApiGatewayTopProps extends StackProps {
  apiDefaultHandlerLambda: NodejsFunction;
  instanceId: string;
}

export class HttpApiGatewayTop extends NestedStack {
  constructor(scope: Construct, id: string, props: HttpApiGatewayTopProps) {
    super(scope, id, props);

    const { apiDefaultHandlerLambda, instanceId } = props;

    const apiIntegration = new HttpLambdaIntegration(
      `ApiDefaultHandlerLambda-${instanceId}`,
      apiDefaultHandlerLambda,
    );

    const httpApi = new HttpApi(this, `MultiTenantHttpApi-${instanceId}`);

    const paths = [
      "/user",
      "/user/{userId}",
      "/tenant",
      "/tenant/flush",
      "/tenant/{tenantId}",
      "/tenant/{tenantId}/flush",
      "/message/send",
      "/message/receive",
      "/message/acknowledge",
    ];

    // We need to add each path separately, even though they're mapped to the same lambda,
    // because api-gateway won't parse the path params correctly otherwise.

    for (const path of paths) {
      httpApi.addRoutes({
        path,
        methods: [HttpMethod.ANY],
        integration: apiIntegration,
      });
    }
  }
}
