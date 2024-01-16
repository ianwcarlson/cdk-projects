import { Message } from "@aws-sdk/client-sqs";
import { INSTANCE_ID } from "../../../environment-variables";
import { validateEnvVar } from "../../../utils";
import { encode } from "punycode";

const IntermediateEncoding = "base64url";

const instanceId = validateEnvVar(INSTANCE_ID);
const tenantQueuePrefix = `TenantQueue-${instanceId}`;
const highProrityQueuePrefix = `HighPriorityTenantQueue-${instanceId}`;

export function buildTenantQueueName(tenantId: string) {
  return `${tenantQueuePrefix}-${tenantId}`;
}
export function buildHighPriorityTenantQueueName(tenantId: string) {
  return `${highProrityQueuePrefix}-${tenantId}`;
}

interface AdaptReceivedMessagesInput {
  messages: Message[];
  queueUrl: string;
}

export function adaptReceivedMessages({
  messages,
  queueUrl,
}: AdaptReceivedMessagesInput) {
  return messages.map((message) => {
    return {
      message: message.Body,
      receiptHandle: encodeReceiptHandle({
        id: message.MessageId || "",
        queueUrl,
        receiptHandle: message.ReceiptHandle || "",
      }),
    };
  });
}

interface EncodeReceiptHandleInput {
  id: string;
  queueUrl: string;
  receiptHandle: string;
}

function encodeReceiptHandle({
  id,
  queueUrl,
  receiptHandle,
}: EncodeReceiptHandleInput) {
  // We want to ensure there are no colons in the queue url, since we use
  // colons to separate the queue url from the receipt handle when we
  // return the message to the client.
  const encodedQueueUrl = Buffer.from(queueUrl).toString(IntermediateEncoding);
  const encodedReceiptHandle =
    Buffer.from(receiptHandle).toString(IntermediateEncoding);
  return `${id}:${encodedQueueUrl}:${encodedReceiptHandle}`;
}

export function decodeReceiptHandle(receiptHandle: string) {
  const [id, queueUrl, encodedReceiptHandle] = receiptHandle.split(":");
  const decodedReceiptHandle = Buffer.from(
    encodedReceiptHandle,
    IntermediateEncoding,
  ).toString("utf-8");
  const decodedQueueUrl = Buffer.from(queueUrl, IntermediateEncoding).toString(
    "utf-8",
  );
  return { id, queueUrl: decodedQueueUrl, receiptHandle: decodedReceiptHandle };
}
