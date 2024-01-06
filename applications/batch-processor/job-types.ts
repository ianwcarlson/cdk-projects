export enum JobType {
  FIX_RESOLVED_ON = "FIX_RESOLVED_ON",
}

export enum JobStatus {
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE",
}

export enum JobMessageType {
  DATA = "DATA",
  SHUTDOWN = "SHUTDOWN",
}

export interface JobMessageBody {
  batchIndex: number;
  data: Array<string | number>;
  jobProperties: object;
  messageType: JobMessageType;
}

export interface JobStatusMessageBody {
  batchIndex: number;
  processedData: Array<string | number>;
  jobProperties: object;
  status: JobStatus;
}
