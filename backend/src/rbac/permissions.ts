// Permission keys are data. Adding a permission = add it here + grant it to roles; guards need no changes.
export const PERMISSIONS = {
  // Personal finance (always scoped to the caller's own records)
  FINANCE_OWN_READ: 'finance.own.read',
  FINANCE_OWN_WRITE: 'finance.own.write',
  // Organization administration (never grants access to members' financial records)
  ORG_MEMBERS_READ: 'org.members.read',
  ORG_MEMBERS_MANAGE: 'org.members.manage',
  ORG_REPORTS_READ: 'org.reports.read',
  // Platform administration
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_ANALYTICS_READ: 'platform.analytics.read',
  PLATFORM_NOTIFICATIONS_MANAGE: 'platform.notifications.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'finance.own.read': 'Read your own financial records',
  'finance.own.write': 'Create and edit your own financial records',
  'org.members.read': 'View organization members',
  'org.members.manage': 'Invite, remove and change roles of organization members',
  'org.reports.read': 'View aggregate organization reports that members have shared',
  'platform.users.manage': 'Manage platform users',
  'platform.plans.manage': 'Manage subscription plans and feature permissions',
  'platform.analytics.read': 'View platform-level analytics',
  'platform.notifications.manage': 'Configure system-wide notifications',
};

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ORG_ADMIN: 'org_admin',
  STANDARD_USER: 'standard_user',
} as const;

export const ROLE_DEFINITIONS: { key: string; name: string; scope: 'platform' | 'organization'; permissions: PermissionKey[] }[] = [
  {
    key: ROLES.SUPER_ADMIN,
    name: 'Super Admin',
    scope: 'platform',
    permissions: [
      'platform.users.manage',
      'platform.plans.manage',
      'platform.analytics.read',
      'platform.notifications.manage',
    ],
  },
  {
    key: ROLES.ORG_ADMIN,
    name: 'Organization Admin',
    scope: 'organization',
    permissions: [
      'finance.own.read',
      'finance.own.write',
      'org.members.read',
      'org.members.manage',
      'org.reports.read',
    ],
  },
  {
    key: ROLES.STANDARD_USER,
    name: 'Standard User',
    scope: 'organization',
    permissions: ['finance.own.read', 'finance.own.write'],
  },
];
