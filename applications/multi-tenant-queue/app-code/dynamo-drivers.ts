import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { validateEnvVar } from "../../../utils";
import { MULTI_TENANT_TABLE_NAME } from "../../../environment-variables";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  ScanCommandInput,
  ScanCommandOutput,
} from "@aws-sdk/client-dynamodb";

import { dynamoClient } from "../../../lib/sdk-drivers/dynamoDB/dynamo-client";

const multiTenantTableName = validateEnvVar(MULTI_TENANT_TABLE_NAME);

interface CreateTenantInput {
  tenantId: string;
  queueUrl: string;
  highPriorityQueueUrl: string;
}

export async function createTenant({
  tenantId,
  queueUrl,
  highPriorityQueueUrl,
}: CreateTenantInput) {
  const input = {
    TableName: multiTenantTableName,
    Item: marshall({
      tenantId,
      queueUrl,
      highPriorityQueueUrl,
    }),
  };

  console.log("INPUT: " + JSON.stringify(input));

  const command = new PutItemCommand(input);
  return dynamoClient.send(command);
}

export async function getTenant(tenantId: string) {
  const input = {
    TableName: multiTenantTableName,
    Key: {
      tenantId: {
        S: tenantId,
      },
    },
  };
  const command = new GetItemCommand(input);
  const response = await dynamoClient.send(command);

  if (response && response.Item) {
    const { tenantId, queueUrl, highPriorityQueueUrl } = unmarshall(
      response.Item,
    );
    return {
      tenantId,
      queueUrl,
      highPriorityQueueUrl,
    };
  }

  return null;
}

export function deleteTenant(tenantId: string) {
  const input = {
    TableName: multiTenantTableName,
    Key: {
      tenantId: {
        S: tenantId,
      },
    },
  };
  const command = new DeleteItemCommand(input);
  return dynamoClient.send(command);
}

export async function scanTenants({
  tenantId,
  thunk,
}: {
  tenantId: string;
  thunk: (tenantId: string, response: ScanCommandOutput) => void;
}) {
  let exclustiveStartKey;
  do {
    const input: ScanCommandInput = {
      TableName: multiTenantTableName,
      ExclusiveStartKey: exclustiveStartKey,
    };
    const command = new ScanCommand(input);
    const response = await dynamoClient.send(command);
    thunk(tenantId, response);
    exclustiveStartKey = response.LastEvaluatedKey;
  } while (exclustiveStartKey);
}
