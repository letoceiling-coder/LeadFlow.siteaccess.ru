export const ROLES = ["OWNER", "ADMIN", "MANAGER", "ANALYST", "OPERATOR", "VIEWER"] as const;
export type RoleName = (typeof ROLES)[number];

const ALL = ["*"] as const;

const ROLE_PERMISSIONS: Record<RoleName, readonly string[]> = {
  OWNER: ALL,
  ADMIN: [
    "org.read",
    "org.write",
    "org.delete",
    "search.manage",
    "analysis.manage",
    "analysis.read",
    "sites.manage",
    "sites.read",
    "sites.publish",
    "qa.manage",
    "crm.manage",
    "crm.read",
    "lead.manage",
    "task.manage",
    "comms.manage",
    "comms.read",
    "campaigns.manage",
    "campaigns.approve",
    "automations.manage",
    "analytics.read",
    "team.manage",
    "integrations.manage",
    "settings.manage",
    "audit.read",
    "agent.use",
  ],
  MANAGER: [
    "org.read",
    "lead.manage",
    "crm.manage",
    "crm.read",
    "task.manage",
    "comms.manage",
    "comms.read",
    "campaigns.manage",
    "analytics.read",
    "sites.read",
    "analysis.read",
    "audit.read",
  ],
  ANALYST: ["org.read", "org.write", "search.manage", "analysis.manage", "analysis.read", "analytics.read"],
  OPERATOR: ["org.read", "org.write", "sites.manage", "sites.read", "qa.manage", "task.own", "analysis.read"],
  VIEWER: ["org.read", "analysis.read", "sites.read", "crm.read", "analytics.read", "comms.read", "audit.read"],
};

export function can(role: string, permission: string): boolean {
  const list = ROLE_PERMISSIONS[role as RoleName];
  if (!list) return false;
  if (list.includes("*")) return true;
  if (list.includes(permission)) return true;
  const [group] = permission.split(".");
  return list.includes(`${group}.*`);
}

export function assertRole(role: string): RoleName {
  if ((ROLES as readonly string[]).includes(role)) return role as RoleName;
  throw new Error("Неизвестная роль");
}
