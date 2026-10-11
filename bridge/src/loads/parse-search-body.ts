import { z } from "zod";
import { normalizeSearchLoadsInput } from "./normalize-search-input.ts";
import type { NormalizedSearchLoads } from "./types.ts";

/** Accept optional fields as any string (including ""); normalization drops blanks. */
const searchLoadsBodySchema = z.object({
  equipment_type: z.string(),
  origin_city: z.string().optional(),
  origin_state: z.string().optional(),
  dest_state: z.string().optional(),
  pickup_date: z.string().optional(),
});

export function parseSearchLoadsInput(body: unknown): NormalizedSearchLoads {
  const parsed = searchLoadsBodySchema.parse(body);
  return normalizeSearchLoadsInput(parsed);
}
