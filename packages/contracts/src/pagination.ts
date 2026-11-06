/** @file pagination.ts @description Shared validation for user-selected page sizes. @module contracts */
import { z } from "zod";
export const pageSizeSchema = z.number().int().positive();
