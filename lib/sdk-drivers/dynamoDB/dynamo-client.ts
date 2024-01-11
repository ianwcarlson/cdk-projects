import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { importRegionEnvVar } from "../../../utils";

const region = importRegionEnvVar();

export const dynamoClient = new DynamoDBClient({ region });
