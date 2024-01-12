import { Message } from "@aws-sdk/client-sqs";
import { INSTANCE_ID } from "../../../environment-variables";
import {
  createQueue,
  deleteQueue,
  listQueues,
} from "../../../lib/sdk-drivers/sqs/sqs-io";
import {
  didAnySettledPromisesFail,
  getFulfilledValuesFromSettledPromises,
  sleep,
  validateEnvVar,
} from "../../../utils";
import { createTenant } from "./dynamo-drivers";

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

  if (didAnySettledPromisesFail(queues)) {
    const successResults = getFulfilledValuesFromSettledPromises(queues);
    successResults.forEach((result) => {
      if (result && result.QueueUrl) {
        deleteQueue(result.QueueUrl);
      }

      return { status: 500 };
    });
  }

  await waitForQueueCreation(tenantId);

  await createTenant({
    tenantId,
    queueUrl: buildTenantQueueName(tenantId),
    highPriorityQueueUrl: buildHighPriorityTenantQueueName(tenantId),
  });

  return { status: 200 };
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
  let retryCount = 1000;
  do {
    await sleep(200);
    retryCount -= 1;

    const tenantQueueName = buildTenantQueueName(tenantId);
    const highPriorityQueueName = buildHighPriorityTenantQueueName(tenantId);
    const queues = await listQueues();
    const tenantQueue = queues.find((queue) => queue.includes(tenantQueueName));
    const highProrityQueue = queues.find((queue) =>
      queue.includes(highPriorityQueueName),
    );

    if (tenantQueue && highProrityQueue) {
      break;
    }
  } while (retryCount > 0);
}
