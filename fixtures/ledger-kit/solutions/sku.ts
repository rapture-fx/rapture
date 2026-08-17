const DEPARTMENT = /^[A-Z]{3}$/u;
const IDENTIFIER = /^[0-9]{4}$/u;

export function createSku(department: string, id: string): string {
  if (!DEPARTMENT.test(department)) {
    throw new TypeError("department must be 3 uppercase letters");
  }
  if (!IDENTIFIER.test(id)) {
    throw new TypeError("id must be 4 digits");
  }
  return `${department}-${id}`;
}
