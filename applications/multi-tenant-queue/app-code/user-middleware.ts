import { NextFunction, Response } from "express";
import { RbacRoles } from "./rbac-roles";
import { MiddlewareError } from "./common-types";

export function addUserContext() {
  return function (
    err: MiddlewareError,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    // Not sure how to deal with mutating the request object in Typescript
    // @ts-ignore
    req.user = {
      id: "123",
      roles: [RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin],
    };

    next();
  };
}
