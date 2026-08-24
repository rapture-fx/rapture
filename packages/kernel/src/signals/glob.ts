export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split("\\").join("/").replace(/^\.\//u, "");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char: string = normalized[index] ?? "";
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        const isDirectoryGlob = normalized[index + 2] === "/";
        source += isDirectoryGlob ? "(?:.*/)?" : ".*";
        index += isDirectoryGlob ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`(?:^|/)${source}$`, "u");
}
