import type { JsonValue } from "@rapture/kernel";

export type DifferenceKind = "MATCH" | "MISSING" | "MISMATCH" | "UNEXPECTED";

export interface StateExpectation {
  readonly path: string;
  readonly status: "PASS" | "FAIL";
  readonly difference: DifferenceKind;
  readonly hasExpected: boolean;
  readonly expected?: JsonValue;
  readonly hasActual: boolean;
  readonly actual?: JsonValue;
}

export interface StateDiffOptions {
  readonly unexpected?: "ignore" | "fail";
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPath(parent: string, key: string): string {
  return parent.length === 0 ? key : `${parent}.${key}`;
}

function indexPath(parent: string, index: number): string {
  return `${parent || "$"}[${index}]`;
}

function sameValue(expected: JsonValue, actual: JsonValue): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function missingLeaves(value: JsonValue, path: string, output: StateExpectation[]): void {
  if (isRecord(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) missingLeaves(child, childPath(path, key), output);
    }
    return;
  }
  output.push({
    path,
    status: "FAIL",
    difference: "MISSING",
    hasExpected: true,
    expected: value,
    hasActual: false,
  });
}

function unexpectedLeaves(value: JsonValue, path: string, output: StateExpectation[]): void {
  if (isRecord(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) unexpectedLeaves(child, childPath(path, key), output);
    }
    return;
  }
  output.push({
    path,
    status: "FAIL",
    difference: "UNEXPECTED",
    hasExpected: false,
    hasActual: true,
    actual: value,
  });
}

function compare(
  expected: JsonValue,
  actual: JsonValue,
  path: string,
  options: StateDiffOptions,
  output: StateExpectation[],
): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let index = 0; index < expected.length; index += 1) {
      const expectedValue = expected[index];
      if (expectedValue === undefined) continue;
      const nextPath = indexPath(path, index);
      const actualValue = actual[index];
      if (actualValue === undefined) {
        missingLeaves(expectedValue, nextPath, output);
      } else {
        compare(expectedValue, actualValue, nextPath, options, output);
      }
    }
    if (options.unexpected === "fail") {
      for (let index = expected.length; index < actual.length; index += 1) {
        const actualValue = actual[index];
        if (actualValue !== undefined) {
          unexpectedLeaves(actualValue, indexPath(path, index), output);
        }
      }
    }
    if (expected.length === 0 && actual.length === 0) {
      output.push({
        path: path || "$",
        status: "PASS",
        difference: "MATCH",
        hasExpected: true,
        expected,
        hasActual: true,
        actual,
      });
    }
    return;
  }

  if (isRecord(expected) && isRecord(actual)) {
    const expectedKeys = Object.keys(expected).sort();
    for (const key of expectedKeys) {
      const nextPath = childPath(path, key);
      const expectedValue = expected[key];
      if (expectedValue === undefined) continue;
      if (!Object.hasOwn(actual, key)) {
        missingLeaves(expectedValue, nextPath, output);
        continue;
      }
      const actualValue = actual[key];
      if (actualValue !== undefined) compare(expectedValue, actualValue, nextPath, options, output);
    }
    if (options.unexpected === "fail") {
      for (const key of Object.keys(actual).sort()) {
        if (Object.hasOwn(expected, key)) continue;
        const actualValue = actual[key];
        if (actualValue !== undefined) unexpectedLeaves(actualValue, childPath(path, key), output);
      }
    }
    if (expectedKeys.length === 0 && Object.keys(actual).length === 0) {
      output.push({
        path: path || "$",
        status: "PASS",
        difference: "MATCH",
        hasExpected: true,
        expected,
        hasActual: true,
        actual,
      });
    }
    return;
  }

  const matches = sameValue(expected, actual);
  output.push({
    path: path || "$",
    status: matches ? "PASS" : "FAIL",
    difference: matches ? "MATCH" : "MISMATCH",
    hasExpected: true,
    expected,
    hasActual: true,
    actual,
  });
}

export function diffState(
  expected: JsonValue,
  actual: JsonValue,
  options: StateDiffOptions = {},
): readonly StateExpectation[] {
  const output: StateExpectation[] = [];
  compare(expected, actual, "", options, output);
  return output;
}
