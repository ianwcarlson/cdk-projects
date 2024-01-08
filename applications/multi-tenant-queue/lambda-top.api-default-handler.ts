import serverlessExpress from "@vendia/serverless-express";
import { app } from "./app-code/api";

export const handler = serverlessExpress({ app });
