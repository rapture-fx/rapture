export function parseConfig(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      throw new SyntaxError(`invalid config line: ${line}`);
    }
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}
