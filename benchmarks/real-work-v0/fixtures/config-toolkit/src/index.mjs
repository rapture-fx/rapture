export function loadEndpoint(input = {}) {
  return {
    url: input.url ?? "http://localhost:3000",
    timeoutMs: input.timeoutMs ?? 5000,
  };
}
