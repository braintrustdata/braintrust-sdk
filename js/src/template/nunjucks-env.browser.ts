export function getNunjucksEnv(): never {
  throw new Error(
    "Nunjucks templating is not supported in this build. Use templateFormat: 'mustache' (or omit templateFormat).",
  );
}

export function renderNunjucksString(): never {
  throw new Error(
    "Nunjucks templating is not supported in this build. Use templateFormat: 'mustache' (or omit templateFormat).",
  );
}
