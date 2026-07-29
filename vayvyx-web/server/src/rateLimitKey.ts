import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

export function mailRateLimitKey(request: Request) {
  return request.auth?.userId ?? ipKeyGenerator(request.ip ?? "127.0.0.1");
}
