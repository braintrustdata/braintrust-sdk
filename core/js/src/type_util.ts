/**
 * @example
 * isObject([1, 2, 3]) // false
 */
export function isObject(value: any): value is { [key: string]: any } {
  return value instanceof Object && !(value instanceof Array);
}

export function isArray(value: any): value is any[] {
  return value instanceof Array;
}

export function isEmpty(a: any): a is null | undefined {
  return a === undefined || a === null;
}

export function isNumber(a: any) {
  return typeof a === "number" || typeof a === "bigint";
}
