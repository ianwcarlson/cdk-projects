import { ECSClient } from "@aws-sdk/client-ecs";
import { importRegionEnvVar } from "../../../utils";

const region = importRegionEnvVar();

export const ecsClient = new ECSClient({ region });
