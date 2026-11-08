/// Client-side checks mirror the backend rules so users get instant feedback; the server remains
/// the authority and its field errors are shown too.
abstract final class Validators {
  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
  static final _password = RegExp(r'^(?=.*[A-Za-z])(?=.*\d).{10,128}$');

  static String? email(String v) {
    if (v.trim().isEmpty) return 'Enter your email address.';
    if (!_email.hasMatch(v.trim())) return 'Enter a valid email address, like name@example.com.';
    return null;
  }

  static String? passwordForSignIn(String v) => v.isEmpty ? 'Enter your password.' : null;

  static String? newPassword(String v) {
    if (v.isEmpty) return 'Create a password.';
    if (!_password.hasMatch(v)) return 'Use at least 10 characters with at least one letter and one number.';
    return null;
  }

  static String? fullName(String v) {
    if (v.trim().isEmpty) return 'Enter your name.';
    if (v.trim().length > 120) return 'Use 120 characters or fewer.';
    return null;
  }
}
