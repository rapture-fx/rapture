export function createSku(department: string, id: string): string {
  return `${department}-${id}`;
}
