import express, { NextFunction, Request, Response } from "express";
import path from "path";
import * as OpenApiValidator from "express-openapi-validator";

// @ts-ignore
import pathToSpec from "./api-spec.yaml";

import userRoutes from "./user-routes";
import messageRoutes from "./message-routes";
import { addUserContext } from "./user-middleware";
import { MiddlewareError } from "./common-types";

const app = express();

const port = process.env.PORT || 3000;

// 1. Import the express-openapi-validator library

// 2. Set up body parsers for the request body types you expect
//    Must be specified prior to endpoints in 5.
app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: false }));

// 3. (optionally) Serve the OpenAPI spec
// const spec = pathToSpec;
app.use("/spec", express.static(pathToSpec));

// 4. Install the OpenApiValidator onto your express app
app.use(
  OpenApiValidator.middleware({
    apiSpec: pathToSpec,
    validateRequests: true,
  }),
);

app.use(
  (err: MiddlewareError, req: Request, res: Response, next: NextFunction) => {
    // format errors
    res.status(err.status || 500).json({
      message: err.message,
      errors: err.errors,
    });
  },
);

app.use(addUserContext);

app.use("/user", userRoutes);
app.use("/message", messageRoutes);

// http.createServer(app).listen(port);
// console.log(`Listening on port ${port}`);;

export { app };
