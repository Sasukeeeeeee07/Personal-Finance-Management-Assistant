/// Mirrors `GET /api/v1/auth/me` (docs/API_CONTRACT.md).
class Membership {
  const Membership({required this.id, required this.name, required this.type, required this.plan, required this.role});

  final String id;
  final String name;
  final String type;
  final String plan;
  final String role;

  factory Membership.fromJson(Map<String, dynamic> j) =>
      Membership(id: j['id'] as String, name: j['name'] as String, type: j['type'] as String, plan: j['plan'] as String, role: j['role'] as String);
}

class CurrentUser {
  const CurrentUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.emailVerified,
    required this.platformRole,
    required this.activeOrganizationId,
    required this.organizations,
    required this.permissions,
  });

  final String id;
  final String email;
  final String fullName;
  final bool emailVerified;
  final String? platformRole;
  final String activeOrganizationId;
  final List<Membership> organizations;
  final List<String> permissions;

  Membership? get activeOrganization {
    for (final o in organizations) {
      if (o.id == activeOrganizationId) return o;
    }
    return null;
  }

  factory CurrentUser.fromJson(Map<String, dynamic> j) => CurrentUser(
        id: j['id'] as String,
        email: j['email'] as String,
        fullName: j['fullName'] as String,
        emailVerified: j['emailVerified'] as bool,
        platformRole: j['platformRole'] as String?,
        activeOrganizationId: j['activeOrganizationId'] as String,
        organizations: (j['organizations'] as List).map((o) => Membership.fromJson(o as Map<String, dynamic>)).toList(),
        permissions: (j['permissions'] as List).cast<String>(),
      );
}

class ActiveSession {
  const ActiveSession({required this.id, required this.userAgent, required this.createdAt});

  final String id;
  final String? userAgent;
  final DateTime createdAt;

  factory ActiveSession.fromJson(Map<String, dynamic> j) =>
      ActiveSession(id: j['id'] as String, userAgent: j['user_agent'] as String?, createdAt: DateTime.parse(j['created_at'] as String));
}
