import { PROCESS_ID, REGION } from "../environment-variables";
import { createLogStream, putLogEvents } from "../lib/sdk-drivers/cloudwatch/cloudwatch-io";
import { validateEnvVar } from "../utils";

const processId = validateEnvVar(PROCESS_ID)

const LogGroupName = "/aws/batch-processor";
const LogStreamName = `orchestrator-${processId}`;

const MAX_BUFFER_SIZE = 50;
const FLUSH_BUFFER_TIMEOUT_MS = 2000;

export enum LogLevelEnum {
  INFO = "info",
  ERROR = "error",
}

interface LogPayloadInternal {
  timestamp: number;
  message: string;
}

export class LogBuffer {
  timeoutHandle: NodeJS.Timeout;
  bufferSize: number;
  logBuffer: LogPayloadInternal[] = [];
  userId: string;
  runnerId: string;
  runId: string;
  byteOffset: number;
  logStreamInitialized: boolean;

  constructor() {
    this.timeoutHandle = setTimeout(() => {
      this.flushBuffer(false);
    }, FLUSH_BUFFER_TIMEOUT_MS);
    this.bufferSize = 0;
    this.byteOffset = 0;
    this.logStreamInitialized = false;
  }

  public async log(log: string, level?: LogLevelEnum) {
    if (!this.logStreamInitialized) {
      this.logStreamInitialized = true;
      await createLogStream({
        logGroupName: LogGroupName,
        logStreamName: LogStreamName,
      });
    }
    const len = log.length;
    this.logBuffer.push({ timestamp: Date.now(), message: log });
    this.bufferSize += len;

    if (this.bufferSize > MAX_BUFFER_SIZE) {
      this.flushBuffer(false);
    }
  }

  private flushBuffer(cancel: boolean) {
    clearTimeout(this.timeoutHandle);

    this.bufferSize = 0;

    // We don't await to avoid blocking the main thread
    putLogEvents({
      logGroupName: LogGroupName,
      logStreamName: LogStreamName,
      logEvents: this.logBuffer,
    });

    this.logBuffer = [];

    if (!cancel) {
      this.timeoutHandle = setTimeout(() => {
        this.flushBuffer(false);
      }, FLUSH_BUFFER_TIMEOUT_MS);
    }
  }

  public stopLogBuffer(exitLog: string) {
    this.logBuffer.push({
      timestamp: Date.now(),
      message: exitLog,
    });
    this.flushBuffer(true);
  }
}
