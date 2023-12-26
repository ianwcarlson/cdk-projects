import { PROCESS_ID } from "../environment-variables";
import {
  createLogStream,
  putLogEvents,
} from "../lib/sdk-drivers/cloudwatch/cloudwatch-io";
import { validateEnvVar } from "../utils";

const processId = Date.now().toString();

console.log("PROCESS_ID", processId);

const LogGroupName = "/aws/batch-processor";

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
  logStreamName: string;

  constructor(logStreamPrefix: string) {
    this.timeoutHandle = setTimeout(() => {
      this.flushBuffer(false);
    }, FLUSH_BUFFER_TIMEOUT_MS);
    this.bufferSize = 0;
    this.byteOffset = 0;
    this.logStreamInitialized = false;
    this.logStreamName = `${logStreamPrefix}-${processId}`;
  }

  public async log(log: string, level?: LogLevelEnum) {
    if (!this.logStreamInitialized) {
      this.logStreamInitialized = true;
      console.log("Creating log stream", this.logStreamName);
      try {
        await createLogStream({
          logGroupName: LogGroupName,
          logStreamName: this.logStreamName,
        });
      } catch (e) {
        // console.log("Error creating log stream", e);
      }
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
      logStreamName: this.logStreamName,
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
