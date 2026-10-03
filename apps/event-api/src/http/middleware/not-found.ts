import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `No API route for ${req.method} ${req.path}.`));
};
