import { z } from "zod";

// Region IDs become workflow/edition identity and prompt context; canonical
// digits prevent aliases and injection content at the shared boundary.
export const ActiveRegionIdSchema = z.string().regex(/^[1-9]\d{0,9}$/);
