export class IdempotencyRegistry {
  #completed = new Map();

  async executeOnce(key, operation) {
    if (this.#completed.has(key)) return this.#completed.get(key);
    const result = await operation();
    this.#completed.set(key, result);
    return result;
  }
}
