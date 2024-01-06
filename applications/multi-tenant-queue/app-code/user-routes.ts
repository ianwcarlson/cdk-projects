import { Router, Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  console.log("Request payload: " + JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

router.get("/:userId", async (req: Request, res: Response) => {
  res.status(200).send({
    userId: req.params.userId,
  });
});

export default router;
