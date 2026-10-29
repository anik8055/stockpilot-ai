export type Role = "owner" | "admin" | "staff";

export const PERMISSIONS = {
  view: ["owner", "admin", "staff"],
  "inventory.edit": ["owner", "admin", "staff"],
  "inventory.adjust": ["owner", "admin"],
  "imports.run": ["owner", "admin"],
  "suppliers.edit": ["owner", "admin", "staff"],
  "purchasing.draft": ["owner", "admin", "staff"],
  "purchasing.approve": ["owner", "admin"],
  "receipts.confirm": ["owner", "admin", "staff"],
  "invoices.upload": ["owner", "admin", "staff"],
  "reports.generate": ["owner", "admin", "staff"],
  "assistant.use": ["owner", "admin", "staff"],
  "settings.manage": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  "business.delete": ["owner"],
  "billing.manage": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Administrator", staff: "Staff" };
