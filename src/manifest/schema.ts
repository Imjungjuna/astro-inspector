import * as z from "zod/v4";
import { INSTANCE_LABEL_MAX, TOKEN_PATTERN } from "../shared/contracts.js";

const SourceTagSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$-]*(?:[.:][A-Za-z_$][A-Za-z0-9_$-]*)*$/u);
const DomTagSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const InstanceSchema = z.number().int().positive();
const InstanceLabelSchema = z.string().max(INSTANCE_LABEL_MAX);

/** 둘은 함께 오거나 함께 없어야 한다. 한쪽만 오면 힌트가 반쪽이라 거부한다. */
function hasPairedInstance(value: {
  instance?: number | undefined;
  instanceLabel?: string | undefined;
}): boolean {
  return (value.instance === undefined) === (value.instanceLabel === undefined);
}

const PAIRED_INSTANCE_MESSAGE =
  "instance and instanceLabel must be provided together";

export const LocatorManifestEntrySchema = z
  .object({
    file: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    sourceTag: SourceTagSchema,
    domTag: DomTagSchema,
    instance: InstanceSchema.optional(),
    instanceLabel: InstanceLabelSchema.optional()
  })
  .strict()
  .refine(hasPairedInstance, { message: PAIRED_INSTANCE_MESSAGE });

export const LocatorManifestSchema = z
  .object({
    schemaVersion: z.literal(3),
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
    domTag: DomTagSchema,
    instance: InstanceSchema.optional(),
    instanceLabel: InstanceLabelSchema.optional()
  })
  .strict()
  .refine(hasPairedInstance, { message: PAIRED_INSTANCE_MESSAGE });
