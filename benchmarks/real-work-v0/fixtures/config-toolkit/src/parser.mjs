export function parseConfig(text) {
  const output = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new SyntaxError(`invalid config line: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    output[key] = value;
  }
  return output;
}
