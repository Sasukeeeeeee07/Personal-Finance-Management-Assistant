// Phase 1: tenants, users, sessions, RBAC, audit log.
export const name = '001_foundation';

export const up = /* sql */ `
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  type          text NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'business')),
  plan_code     text NOT NULL DEFAULT 'free',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  name          text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('platform', 'organization')),
  is_system     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  description   text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    text NOT NULL,
  password_hash            text,
  full_name                text NOT NULL,
  email_verified_at        timestamptz,
  google_sub               text UNIQUE,
  platform_role_id         uuid REFERENCES roles(id),
  default_organization_id  uuid REFERENCES organizations(id),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE organization_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id          uuid NOT NULL REFERENCES roles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- Refresh tokens: only a SHA-256 hash is stored. family_id groups a rotation chain.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id     uuid NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  rotated_at    timestamptz,
  revoked_at    timestamptz,
  user_agent    text,
  ip_address    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id               bigserial PRIMARY KEY,
  organization_id  uuid REFERENCES organizations(id),
  actor_id         uuid REFERENCES users(id),
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  action           text NOT NULL,
  before           jsonb,
  after            jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
`;
