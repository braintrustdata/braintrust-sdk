export function _urljoin(...parts: string[]): string {
  return parts
    .map((x, i) =>
      x.replace(/^\//, "").replace(i < parts.length - 1 ? /\/$/ : "", ""),
    )
    .filter((x) => x.trim() !== "")
    .join("/");
}

export function capitalize(s: string, sep?: string) {
  const items = sep ? s.split(sep) : [s];
  return items
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(sep || "");
}

export function lowercase(s: string, sep?: string) {
  const items = sep ? s.split(sep) : [s];
  return items
    .map((s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s))
    .join(sep || "");
}

export function snakeToCamelCase(s: string) {
  return s
    .split("_")
    .map((s) => capitalize(s))
    .join("");
}

export function snakeToTitleCase(s: string) {
  return capitalize(s, "_").replace("_", " ");
}

export function camelToSnakeCase(s: string) {
  return s.replace(/([A-Z])/g, (m) => "_" + m.toLowerCase()).replace(/^_/, "");
}
