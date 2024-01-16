import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { validateEnvVar } from "../../../utils";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  ScanCommandInput,
  ScanCommandOutput,
} from "@aws-sdk/client-dynamodb";

import { dynamoClient } from "../../../lib/sdk-drivers/dynamoDB/dynamo-client";

interface CreateTenantInput {
  tenantId: string;
  queueUrl: string;
  highPriorityQueueUrl: string;
}
