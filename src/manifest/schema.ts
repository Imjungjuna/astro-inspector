import * as z from "zod/v4";
import { TOKEN_PATTERN } from "../shared/contracts.js";

const SourceTagSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$-]*(?:[.:][A-Za-z_$][A-Za-z0-9_$-]*)*$/u);
const DomTagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u);

export const LocatorManifestEntrySchema = z
  .object({
    file: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    sourceTag: SourceTagSchema,
    domTag: DomTagSchema
  })
  .strict();

export const LocatorManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    entries: z.record(
      z.string().regex(TOKEN_PATTERN),
      LocatorManifestEntrySchema
    )
  })
  .strict();

export const RegisterElementRequestSchema = z
  .object({
    sourceFile: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    sourceTag: SourceTagSchema,
    domTag: DomTagSchema
  })
  .strict();
