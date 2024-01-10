import { NextFunction, Response, Request } from "express";
import { RbacRoles } from "./rbac-roles";

export function addUserContext(
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
}
