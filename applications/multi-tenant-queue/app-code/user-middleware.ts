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
    // @ts-ignore
    req.user = {
      id: "123",
      roles: [RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin],
    };

    next();
  };
}
