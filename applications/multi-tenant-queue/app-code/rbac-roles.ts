import { NextFunction, Request, Response } from "express";
import { RequestWithUser } from "./common-types";

export enum RbacRoles {
  Read = "Read",
  Write = "Write",
  Admin = "Admin",
}

export const verifyRole = (allowedRoles: RbacRoles[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Typescript really doens't like express's mutation. There's got to be
    // a better way to do this.
    // @ts-ignore
    const userRoles: RbacRoles[] = req.user.roles;

    if (!userRoles.some((r: RbacRoles) => allowedRoles.includes(r))) {
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

// export function verifyRole(role: string): RbacRoles {
//   if (Object.values(RbacRoles).includes(role as RbacRoles)) {
//     return role as RbacRoles;
//   } else {
//     throw new Error(`Invalid role: ${role}`);
//   }
// }
