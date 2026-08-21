import { mergeConfig } from "./merge.mjs";

export function loadConfiguration({ defaults, file, environment, cli }) {
  return mergeConfig(mergeConfig(mergeConfig(defaults, environment), file), cli);
}
