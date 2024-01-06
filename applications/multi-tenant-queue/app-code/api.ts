import express, { NextFunction, Request, Response } from "express";
import path from "path";
import http from "http";
import * as OpenApiValidator from "express-openapi-validator";

import userRoutes from "./user-routes";

const app = express();

const port = process.env.PORT || 3000;

// 1. Import the express-openapi-validator library

// 2. Set up body parsers for the request body types you expect
//    Must be specified prior to endpoints in 5.
app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: false }));

// 3. (optionally) Serve the OpenAPI spec
const spec = path.join(__dirname, "api.yaml");
app.use("/spec", express.static(spec));

// 4. Install the OpenApiValidator onto your express app
app.use(
  OpenApiValidator.middleware({
    apiSpec: path.resolve(__dirname, "api.yaml"),
    validateResponses: true, // <-- to validate responses
  }),
);

interface MiddlewareError {
  status?: number;
  message?: string;
  errors?: any[];
}

app.use(
  (err: MiddlewareError, req: Request, res: Response, next: NextFunction) => {
    // format errors
    res.status(err.status || 500).json({
      message: err.message,
      errors: err.errors,
    });
  },
);

app.use("/user", userRoutes);

// http.createServer(app).listen(port);
// console.log(`Listening on port ${port}`);

export { app };
