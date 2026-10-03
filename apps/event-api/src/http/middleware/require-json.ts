import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";
import { MUTATING_METHODS } from "./origin-guard.js";

/** Mutations must be JSON, which also blocks HTML-form CSRF (S1). */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (MUTATING_METHODS.has(req.method) && req.is("application/json") !== "application/json") {
    next(
      new AppError(
        "VALIDATION_FAILED",
        "Send the request body as JSON (Content-Type: application/json).",
      ),
    );
    return;
  }
  next();
};
