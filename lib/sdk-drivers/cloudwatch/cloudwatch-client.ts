import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { importRegionEnvVar } from "../../../utils";

const region = importRegionEnvVar();

export const cloudwatchLogsClient = new CloudWatchLogsClient({ region });
