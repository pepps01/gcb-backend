/** Per-tenant roles, stored on tenant_members.role. */
export const ROLES = ['supporter', 'situation_agent', 'lga_coordinator', 'treasurer', 'tenant_admin'] as const;
export type Role = (typeof ROLES)[number];
