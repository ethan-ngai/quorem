/** @file request.ts @description Bounded advisory HTTP request decoding. @module interviews */
import { jsonObjectBody } from "../../../application/json-body.ts";
export const advisoryBody = (request: Request) => jsonObjectBody(request, 1024);
