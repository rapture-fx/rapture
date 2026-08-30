export type FileClass = "test" | "ci" | "test_config" | "other";

/**
 * Structural test-file classification.
 *
 * `scripts/test-*.mjs` is included because the calibration corpus contained a
 * hand-rolled assertion harness at exactly that path, which a tests/-directory
 * or `.test.` suffix rule alone does not match.
 */
export function isTestFile(path: string): boolean {
  const p = path.toLowerCase();
  if (/(^|\/)(tests?|spec|specs|__tests__)\//.test(p)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return true;
  if (/(^|\/)test_[^/]+\.py$/.test(p)) return true;
  if (/(^|\/)test-[^/]+\.[cm]?[jt]s$/.test(p)) return true;
  if (/_test\.(py|go|rb|ts|js)$/.test(p)) return true;
  if (/(^|\/)[^/]+_spec\.rb$/.test(p)) return true;
  if (/(^|\/)[^/]+tests?\.cs$/.test(p)) return true;
  if (/(^|\/)[^/]+Test\.java$/.test(p)) return true;
  return false;
}

export function isCiFile(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) ||
    /^\.gitlab-ci\.ya?ml$/.test(p) ||
    /^\.circleci\/config\.ya?ml$/.test(p) ||
    /(^|\/)azure-pipelines\.ya?ml$/.test(p) ||
    /^jenkinsfile$/.test(p)
  );
}

export function isTestConfigFile(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|conftest\.py)$/.test(p) ||
    /(^|\/)(jest|vitest|karma)\.config\.[cm]?[jt]s$/.test(p) ||
    /(^|\/)\.coveragerc$/.test(p) ||
    /(^|\/)codecov\.ya?ml$/.test(p) ||
    /(^|\/)\.nycrc(\.json)?$/.test(p)
  );
}

export function classifyFile(path: string): FileClass {
  if (isTestFile(path)) return "test";
  if (isCiFile(path)) return "ci";
  if (isTestConfigFile(path)) return "test_config";
  return "other";
}

export type Language = "python" | "jsts" | "csharp" | "unknown";

export function languageOf(path: string): Language {
  if (/\.py$/i.test(path)) return "python";
  if (/\.[cm]?[jt]sx?$/i.test(path)) return "jsts";
  if (/\.cs$/i.test(path)) return "csharp";
  return "unknown";
}
