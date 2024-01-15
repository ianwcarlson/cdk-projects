import { Message } from "@aws-sdk/client-sqs";
import { INSTANCE_ID } from "../../../environment-variables";
import {
  createQueue,
  deleteQueue,
  listQueues,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import {
  didAnySettledPromisesFail,
  getFailedValuesFromSettledPromises,
  getFulfilledValuesFromSettledPromises,
  sleep,
  validateEnvVar,
} from "../../../utils";
import { createTenant, scanTenants } from "./dynamo-drivers";

const instanceId = validateEnvVar(INSTANCE_ID);
const tenantQueuePrefix = `TenantQueue-${instanceId}`;
const highProrityQueuePrefix = `HighPriorityTenantQueue-${instanceId}`;

export function buildTenantQueueName(tenantId: string) {
  return `${tenantQueuePrefix}-${tenantId}`;
}
export function buildHighPriorityTenantQueueName(tenantId: string) {
  return `${highProrityQueuePrefix}-${tenantId}`;
}

export async function createTenantService(tenantId: string) {
  const queues = await Promise.allSettled([
    createQueue({ queueName: buildTenantQueueName(tenantId) }),
    createQueue({
      queueName: buildHighPriorityTenantQueueName(tenantId),
    }),
  ]);

  console.log("queues", JSON.stringify(queues));

  if (didAnySettledPromisesFail(queues)) {
    const successResults = getFulfilledValuesFromSettledPromises(queues);
    successResults.forEach((result) => {
      if (result && result.QueueUrl) {
        deleteQueue(result.QueueUrl);
      }
    });
    const failedResults = getFailedValuesFromSettledPromises(queues);
    // Just sample the first failurem for now
    return {
      status: failedResults[0].reason.name,
      message: failedResults[0].reason.$metadata.httpStatusCode,
    };
  }

  await waitForQueueCreation(tenantId);

  if (queues && queues.length === 2) {
    // @ts-ignore
    console.log("create queueUrl: " + queues[0].value.QueueUrl);
    // @ts-ignore
    console.log("create highPriorityQueueUrl: " + queues[1].value.QueueUrl);
    await createTenant({
      tenantId,
      // @ts-ignore
      queueUrl: queues[0].value.QueueUrl,
      // @ts-ignore
      highPriorityQueueUrl: queues[1].value.QueueUrl,
    });

    return { status: 200 };
  }

  return { status: 500 };
}

export function adaptReceivedMessages(messages: Message[]) {
  return messages.map((message) => {
    return {
      id: message.MessageId,
      message: message.Body,
      receiptHandle: message.ReceiptHandle,
    };
  });
}

async function waitForQueueCreation(tenantId: string) {
  let retryCount = 100;
  do {
    await sleep(1000);
    retryCount -= 1;

    const tenantQueueName = buildTenantQueueName(tenantId);
    const highPriorityQueueName = buildHighPriorityTenantQueueName(tenantId);
    const queues = await listQueues();
    console.log("queues", queues);
    const tenantQueue = queues.find((queue) => queue.includes(tenantQueueName));
    const highProrityQueue = queues.find((queue) =>
      queue.includes(highPriorityQueueName),
    );

    if (tenantQueue && highProrityQueue) {
      break;
    }
  } while (retryCount > 0);
}

export async function purgeAllTenants() {
  await scanTenants(() => {});
}
