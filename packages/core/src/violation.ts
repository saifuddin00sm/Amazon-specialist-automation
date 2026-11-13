import { z } from "zod";

/** The listing rules packages/rules checks, one id per rule. */
export const ViolationRuleSchema = z.enum([
  "title_empty",
  "title_length",
  "title_banned_character",
  "title_word_repetition",
  "prohibited_claim",
  "attribute_schema",
  "product_type_schema",
]);
export type ViolationRule = z.infer<typeof ViolationRuleSchema>;

/** An `error` breaks Amazon's policy and blocks approval; a `warning` is worth a look. */
export const ViolationSeveritySchema = z.enum(["error", "warning"]);
export type ViolationSeverity = z.infer<typeof ViolationSeveritySchema>;

/** One way a piece of listing copy or a set of attributes breaks a rule. */
export const ViolationSchema = z.object({
  rule: ViolationRuleSchema,
  severity: ViolationSeveritySchema,
  message: z.string().min(1),
  /** Where: a listing field ("title") or a JSON pointer into the attributes ("/item_name/0/value"). */
  path: z.string().optional(),
  /** The offending text, character or word. */
  match: z.string().optional(),
  /** Character offset of `match` in the checked text. */
  index: z.number().int().nonnegative().optional(),
  /** How many there are, against `limit`: characters in a title, uses of a word. */
  count: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().optional(),
  /** The JSON Schema keyword that failed, for attribute_schema. */
  keyword: z.string().optional(),
});
export type Violation = z.infer<typeof ViolationSchema>;
