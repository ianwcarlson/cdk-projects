import { RbacRoles } from "./rbac-roles";

export interface RequestWithUser extends Request {
  user: {
    id: string;
    roles: RbacRoles[];
  };
}

export interface MiddlewareError {
  status?: number;
  message?: string;
  errors?: any[];
}

export interface RoundRobinQueueMessage {
  tenantId: string;
  highPriorityQueueName: string;
  tenantQueueName: string;
}
