import serverlessExpress from "@codegenie/serverless-express";
import { app } from "./app-code/api";

export const handler = serverlessExpress({ app });
