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

const instanceId = validateEnvVar(INSTANCE_ID);
const tenantQueuePrefix = `TenantQueue-${instanceId}`;
const highProrityQueuePrefix = `HighPriorityTenantQueue-${instanceId}`;

export function buildTenantQueueName(tenantId: string) {
  return `${tenantQueuePrefix}-${tenantId}`;
}
export function buildHighPriorityTenantQueueName(tenantId: string) {
  return `${highProrityQueuePrefix}-${tenantId}`;
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
