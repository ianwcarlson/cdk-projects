import { Request } from "express";

import { getCurrentInvoke } from "@vendia/serverless-express";

export function conformToExpress(req: Request) {
  const currentInvoke = getCurrentInvoke();
  const { event } = currentInvoke;
  req.params = event.pathParameters;
  if (event.body) {
    req.body = JSON.parse(event.body);
  }
  console.log("EVENT: " + JSON.stringify(event, null, 2));
  return req;
}
