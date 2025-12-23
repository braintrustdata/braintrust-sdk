import { z } from "zod";
import { zRecordCompat } from "../util/zod_compat";

export const posSchema = z.strictObject({
  line: z.number(),
  col: z.number(),
});

export const locSchema = z.strictObject({
  start: posSchema,
  end: posSchema,
});
export type Loc = z.infer<typeof locSchema>;
type NullableLoc = Loc | null;

const loc = locSchema.nullish();

export const nullLiteralSchema = z.null();
export type ParsedNull = z.infer<typeof nullLiteralSchema>;
export const booleanLiteralSchema = z.boolean();
export type ParsedBoolean = z.infer<typeof booleanLiteralSchema>;
export const integerLiteralSchema = z.union([z.number().int(), z.bigint()]);
export type ParsedInteger = z.infer<typeof integerLiteralSchema>;
export const numberLiteralSchema = z.number();
export type ParsedNumber = z.infer<typeof numberLiteralSchema>;
export const stringLiteralSchema = z.string();
export type ParsedString = z.infer<typeof stringLiteralSchema>;
export const datetimeLiteralSchema = z.string().datetime({ offset: true });
export type ParsedDatetime = z.infer<typeof datetimeLiteralSchema>;

export type ParsedArray = LiteralValue[];

export const arrayLiteralSchema: z.ZodArray<z.ZodTypeAny> = z.array(
  z.lazy(() => literalValueSchema),
);

// By _not_ making this a type alias, i.e. `type ParsedObject = Record<string, LiteralValue>`,
// it avoids some typechecking issues with the `z.record` function.
export interface ParsedObject {
  [key: string]: LiteralValue;
}

export const parsedObjectSchema = zRecordCompat(
  z.lazy(() => literalValueSchema),
);

export type LiteralValue =
  | ParsedNull
  | ParsedBoolean
  | ParsedInteger
  | ParsedNumber
  | ParsedString
  | ParsedDatetime
  | ParsedArray
  | ParsedObject;

export const literalValueSchema = z.union([
  nullLiteralSchema,
  booleanLiteralSchema,
  integerLiteralSchema,
  numberLiteralSchema,
  stringLiteralSchema,
  datetimeLiteralSchema,
  arrayLiteralSchema,
  z.lazy(() => parsedObjectSchema),
]);

export const literalSchema = z.object({
  op: z.literal("literal"),
  value: literalValueSchema,
  loc,
});
export type Literal = z.infer<typeof literalSchema>;

export const intervalUnitSchema = z.enum([
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
  "microsecond",
]);
export const intervalLiteralSchema = z.strictObject({
  op: z.literal("interval"),
  value: z.number().int(),
  unit: intervalUnitSchema,
  loc,
});
export type Interval = z.infer<typeof intervalLiteralSchema>;

export const identPieceSchema = z.union([z.string(), z.number()]);
export type IdentPiece = z.infer<typeof identPieceSchema>;

export const identSchema = z.strictObject({
  op: z.literal("ident"),
  name: z.array(identPieceSchema),
  loc,
});

// @ts-expect-error TS7022: Recursive schema type inference
export const starSchema = z.strictObject({
  op: z.literal("star"),
  replace: zRecordCompat(z.lazy(() => exprSchema)).optional(),
  loc,
});
export type Star = z.infer<typeof starSchema>;

export interface Function {
  op: "function";
  name: z.infer<typeof identSchema>;
  args: (Expr | AliasExpr)[];
  loc?: NullableLoc;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const functionSchema = z.object({
  op: z.literal("function"),
  name: identSchema,
  args: z.array(z.union([z.lazy(() => exprSchema), z.lazy(() => aliasExpr)])),
  loc,
});

export const comparisonOps = [
  "eq",
  "is",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "ilike",
  "like",
  "match",
  "in",
] as const;
export type ComparisonOp = (typeof comparisonOps)[number];
export interface ComparisonExpr {
  op: ComparisonOp;
  left: Expr;
  right: Expr;
  loc?: NullableLoc;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const comparisonExprSchema = z.strictObject({
  op: z.enum(comparisonOps),
  left: z.lazy(() => exprSchema),
  right: z.lazy(() => exprSchema),
  loc,
});

export interface IncludesExpr {
  op: "includes";
  haystack: Expr;
  needle: Expr;
  loc?: NullableLoc;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const includesExprSchema = z.strictObject({
  op: z.literal("includes"),
  haystack: z.lazy(() => exprSchema),
  needle: z.lazy(() => exprSchema),
  loc,
});

export const booleanOps = ["and", "or"] as const;
export type BooleanOp = (typeof booleanOps)[number];
export interface BooleanExpr {
  op: BooleanOp;
  left?: Expr;
  right?: Expr;
  children?: Expr[];
  loc?: NullableLoc;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const booleanExprSchema = z.strictObject({
  op: z.enum(booleanOps),
  left: z.lazy(() => exprSchema).optional(),
  right: z.lazy(() => exprSchema).optional(),
  children: z.array(z.lazy(() => exprSchema)).optional(),
  loc,
});

export const arithmeticOps = ["add", "sub", "mul", "div", "mod"] as const;
export type ArithmeticOp = (typeof arithmeticOps)[number];

export interface TernaryCond {
  cond: Expr;
  then: Expr;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const ternaryCondSchema = z.strictObject({
  cond: z.lazy(() => exprSchema),
  then: z.lazy(() => exprSchema),
});

export interface TernaryExpr {
  op: "if";
  conds: TernaryCond[];
  else: Expr;
  loc?: NullableLoc;
}

// This is flattened into an array so that it's easier to pass along an extended
// expression directly.

// @ts-expect-error TS7022: Recursive schema type inference
export const ternaryExprSchema = z.strictObject({
  op: z.literal("if"),
  conds: z.array(ternaryCondSchema),
  else: z.lazy(() => exprSchema),
  loc,
});
export interface ArithmeticExpr {
  op: ArithmeticOp;
  left: Expr;
  right: Expr;
  loc?: NullableLoc;
}

// @ts-expect-error TS7022: Recursive schema type inference
export const arithmeticExprSchema = z.strictObject({
  op: z.enum(arithmeticOps),
  left: z.lazy(() => exprSchema),
  right: z.lazy(() => exprSchema),
  loc,
});

export const unaryArithmeticOps = ["neg"] as const;
export type UnaryArithmeticOp = (typeof unaryArithmeticOps)[number];
export interface UnaryArithmeticExpr {
  op: UnaryArithmeticOp;
  expr: Expr;
  loc?: NullableLoc;
}
// @ts-expect-error TS7022: Recursive schema type inference
export const unaryArithmeticExprSchema = z.strictObject({
  op: z.enum(unaryArithmeticOps),
  expr: z.lazy(() => exprSchema),
  loc,
});

export const unaryOps = ["not", "isnull", "isnotnull"] as const;
export type UnaryOp = (typeof unaryOps)[number];
export interface UnaryExpr {
  op: UnaryOp;
  expr: Expr;
  loc?: NullableLoc;
}
// @ts-expect-error TS7022: Recursive schema type inference
export const unaryExprSchema = z.strictObject({
  op: z.enum(unaryOps),
  expr: z.lazy(() => exprSchema),
  loc,
});

export const btqlSnippetSchema = z.strictObject({
  btql: z.string(),

  // These fields do not need to be present, but making them optional calms down
  // the typesystem in a bunch of places
  op: z.literal("btql").nullish(),
  loc: locSchema.nullish(),
});
export type BtqlSnippet = z.infer<typeof btqlSnippetSchema>;

export type SingleSpanFilter = {
  op: "singlespanfilter";
  expr: Expr;
  loc?: NullableLoc;
};
// @ts-expect-error TS7022: Recursive schema type inference
export const singleSpanFilterSchema = z.strictObject({
  op: z.literal("singlespanfilter"),
  expr: z.lazy(() => exprSchema),
  loc,
});

export type Expr =
  | z.infer<typeof literalSchema>
  | z.infer<typeof intervalLiteralSchema>
  | z.infer<typeof identSchema>
  | z.infer<typeof starSchema>
  | Function
  | ComparisonExpr
  | IncludesExpr
  | BooleanExpr
  | TernaryExpr
  | UnaryArithmeticExpr
  | UnaryExpr
  | ArithmeticExpr
  | BtqlSnippet
  | SingleSpanFilter;

// @ts-expect-error TS7022: Recursive schema type inference
export const exprSchema = z.union([
  literalSchema,
  intervalLiteralSchema,
  identSchema,
  starSchema,
  functionSchema,
  comparisonExprSchema,
  includesExprSchema,
  booleanExprSchema,
  ternaryExprSchema,
  unaryArithmeticExprSchema,
  unaryExprSchema,
  arithmeticExprSchema,
  btqlSnippetSchema,
  singleSpanFilterSchema,
]);

// @ts-expect-error TS7022: Recursive schema type inference
export const aliasExpr = z.strictObject({
  expr: exprSchema,
  alias: z.string(),
});
//

export type AliasExpr = z.infer<typeof aliasExpr>;

export const unpivotAliasExpr = z.strictObject({
  expr: exprSchema,
  alias: z.union([z.string(), z.tuple([z.string(), z.string()])]),
});
export type UnpivotAliasExpr = z.infer<typeof unpivotAliasExpr>;

export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const sortExpr = z.strictObject({
  expr: exprSchema,
  dir: sortDirectionSchema,
  loc: locSchema.nullish(),
});

export type SortExpr = z.infer<typeof sortExpr>;

export const shapeSchema = z.enum(["spans", "traces", "summary"]);
export type Shape = z.infer<typeof shapeSchema>;

export const fromFunctionSchema = functionSchema.and(
  z.object({
    shape: shapeSchema.nullish(),
  }),
);

export const rateSampleSchema = z.strictObject({
  type: z.literal("rate"),
  value: z.number().min(0).max(1),
});
export type RateSample = z.infer<typeof rateSampleSchema>;

export const countSampleSchema = z.strictObject({
  type: z.literal("count"),
  value: z.number().int().min(1),
});
export type CountSample = z.infer<typeof countSampleSchema>;

export const sampleSchema = z.object({
  method: z.union([rateSampleSchema, countSampleSchema]),
  seed: z.number().int().nullish(),
});
export type Sample = z.infer<typeof sampleSchema>;

export const parsedQuerySchema = z.strictObject({
  dimensions: z.array(aliasExpr).nullish(),
  pivot: z.array(aliasExpr).nullish(),
  unpivot: z.array(unpivotAliasExpr).nullish(),
  measures: z.array(aliasExpr).nullish(),
  select: z.array(z.union([aliasExpr, starSchema])).nullish(),
  infer: z.array(z.union([identSchema, starSchema])).nullish(),
  filter: exprSchema.nullish(),
  from: z.union([identSchema, fromFunctionSchema]).nullish(),
  sort: z.array(sortExpr).nullish(),
  limit: z.number().int().nullish(),
  cursor: z.string().nullish(),
  comparison_key: exprSchema.nullish(),
  weighted_scores: z.array(aliasExpr).nullish(),
  custom_columns: z.array(aliasExpr).nullish(),
  preview_length: z.number().int().nullish(),
  inference_budget: z.number().int().nullish(),
  sample: sampleSchema.nullish(),
  span_filter: exprSchema.nullish(),
  trace_filter: exprSchema.nullish(),
  final_filter: exprSchema.nullish(),
});
export type ParsedQuery = z.infer<typeof parsedQuerySchema>;
