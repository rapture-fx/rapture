export function formatContact(name: string, email: string): string {
  return `${name.trim()} <${email.trim().toLowerCase()}>`;
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
