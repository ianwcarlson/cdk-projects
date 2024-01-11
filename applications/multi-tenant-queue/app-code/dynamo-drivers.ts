import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { validateEnvVar } from "../../../utils";
import { MULTI_TENANT_TABLE_NAME } from "../../../environment-variables";
import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

import { dynamoClient } from "../../../lib/sdk-drivers/dynamoDB/dynamo-client";

const multiTenantTableName = validateEnvVar(MULTI_TENANT_TABLE_NAME);

interface CreateSecretInput {
  tenantid: string;
  queueUrl: string;
}

export async function updateTenant({ tenantid, queueUrl }: CreateSecretInput) {

  const input = {
    TableName: multiTenantTableName,
    Item: marshall({
      tenantid,
      queueUrl,
    }),
  };

  console.log("INPUT: " + JSON.stringify(input));

  const command = new PutItemCommand(input);
  return dynamoClient.send(command);
}

export async function GetTenant(tenantId: string) {
  const input = {
    // GetItemInput
    TableName: multiTenantTableName,
    Key: {
      // required
      tenantId: {
        S: tenantId,
      },
    },
  };
  const command = new GetItemCommand(input);
  const response = await dynamoClient.send(command);

  if (response && response.Item) {
    return unmarshall(response.Item);
  }

  return null;
}
