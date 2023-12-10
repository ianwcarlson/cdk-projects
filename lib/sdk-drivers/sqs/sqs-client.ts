import { SQSClient } from "@aws-sdk/client-sqs";
import { importRegionEnvVar } from "../../../utils";

const region = importRegionEnvVar();

export const sqsClient = new SQSClient({ region });
