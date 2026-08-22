export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function formatContact(name: string, email: string): string {
  return `${name.trim()} <${normalizeEmail(email)}>`;
}

export function emailKey(email: string): string {
  return normalizeEmail(email);
}
