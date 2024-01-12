import { Router, Request, Response } from "express";
import { RbacRoles, verifyRole } from "./rbac-roles";
import { conformToExpress } from "./utils";
import { deleteQueue, purgeQueue } from "../../../lib/sdk-drivers/sqs/sqs-io";
import { deleteTenant, getTenant } from "./dynamo-drivers";
import { createTenantService } from "./common";

const router = Router();

router.post(
  "/",
  // verifyRole([RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    const _req = conformToExpress(req);
    const tenantId = _req.body.tenantId;

    console.log("Creating tenant: " + tenantId);

    const existingTenant = await getTenant(tenantId);
    if (existingTenant) {
      res.send(409).send(`Tenant ${tenantId} already exists`);
      return;
    }

    const response = await createTenantService(tenantId);

    const message =
      response.status === 200 ? "Tenant created" : "Tenant creation failed";

    res.status(response.status).send(message);
  },
);

router.post("/:tenantId/flush", async (req: Request, res: Response) => {
  const _req = conformToExpress(req);
  const tenantId = _req.params.tenantId;

  console.log("Flushing tenant: " + tenantId);

  const existingTenant = await getTenant(tenantId);
  if (!existingTenant) {
    res.status(404).send(`Tenant ${tenantId} does not exist`);
    return;
  }

  await purgeQueue(existingTenant.queueUrl);
  await purgeQueue(existingTenant.highPriorityQueueUrl);

  res.status(200).send("Tenant queue flushed");
});

router.delete(
  "/:tenantId",
  // verifyRole([RbacRoles.Read, RbacRoles.Write, RbacRoles.Admin]),
  async (req: Request, res: Response) => {
    console.log("Deleting tenant");

    const _req = conformToExpress(req);
    const existingTenant = await getTenant(_req.body.tenantId);
    if (existingTenant) {
      await deleteQueue(existingTenant.queueUrl);
      await deleteQueue(existingTenant.highPriorityQueueUrl);
    }
    await deleteTenant(_req.body.tenantId);
  },
);

export default router;
