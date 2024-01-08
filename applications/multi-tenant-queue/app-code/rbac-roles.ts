import { NextFunction, Request, Response } from "express";

export enum RbacRoles {
  Read = "Read",
  Write = "Write",
  Admin = "Admin",
}

const enableRbac = process.env.ENABLE_RBAC === "true";

export const verifyRole = (allowedRoles: RbacRoles[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Typescript expects the request object to always be the same shape
    // for all middleware, but we need to mutate the request object to
    // add the user context among other things.
    // @ts-ignore
    const userRoles: RbacRoles[] = req.user.roles;

    if (
      enableRbac &&
      !userRoles.some((r: RbacRoles) => allowedRoles.includes(r))
    ) {
      res
        .status(403)
        .send(
          `Forbidden. User does not have the required roles: ${allowedRoles}`,
        );
    } else {
      next();
    }
  };
};
