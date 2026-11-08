import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/router/router.dart';
import 'package:pfm_mobile/features/auth/state/auth_controller.dart';

import '../core/fake_backend.dart';
import '../support/app_harness.dart';

void main() {
  group('router redirect rule', () {
    test('sends each auth status to the right place', () {
      expect(authRedirect(AuthStatus.restoring, Routes.profile), Routes.restoring);
      expect(authRedirect(AuthStatus.signedOut, Routes.profile), Routes.signIn);
      expect(authRedirect(AuthStatus.signedOut, Routes.register), isNull);
      expect(authRedirect(AuthStatus.signedIn, Routes.signIn), Routes.home);
      expect(authRedirect(AuthStatus.signedIn, Routes.home), isNull);
      expect(authRedirect(AuthStatus.signedIn, '/transactions/abc'), isNull);
      expect(authRedirect(AuthStatus.signedOut, '/transactions/abc'), Routes.signIn);
      expect(authRedirect(AuthStatus.offline, Routes.home), Routes.offline);
    });
  });

  testWidgets('signed out on launch shows sign-in', (tester) async {
    await pumpApp(tester);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Email'), findsOneWidget); // visible labels
    expect(find.text('Password'), findsOneWidget);
  });

  testWidgets('validates on submit, then signs in and lands on the dashboard', (tester) async {
    final (backend, store) = await pumpApp(tester);
    await tester.tap(find.byKey(const Key('signIn.submit')));
    await tester.pump();
    expect(find.text('Enter your email address.'), findsOneWidget);
    expect(find.text('Enter your password.'), findsOneWidget);
    expect(backend.log.where((l) => l.contains('/auth/login')), isEmpty);

    backend.responses['/auth/login'] = (200, {'accessToken': 'access-1', 'refreshToken': 'refresh-1', 'accessTokenExpiresIn': 900});
    await tester.enterText(find.byKey(const Key('signIn.email')), 'asha@example.com');
    await tester.enterText(find.byKey(const Key('signIn.password')), 'sturdy-password-1');
    await tester.tap(find.byKey(const Key('signIn.submit')));
    await tester.pumpAndSettle();

    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(find.text('Available to spend'), findsOneWidget);
    expect((await store.read())!.accessToken, 'access-1');
    await openProfile(tester);
    expect(find.text('Asha Verma'), findsOneWidget);
    expect(find.text('Confirm your email'), findsOneWidget);
  });

  testWidgets('shows a recoverable message for wrong credentials', (tester) async {
    final (backend, _) = await pumpApp(tester);
    backend.responses['/auth/login'] = (401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'Email or password is incorrect.'});
    await tester.enterText(find.byKey(const Key('signIn.email')), 'asha@example.com');
    await tester.enterText(find.byKey(const Key('signIn.password')), 'wrong-password');
    await tester.tap(find.byKey(const Key('signIn.submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('reset your password'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('register maps server field errors onto fields', (tester) async {
    final (backend, _) = await pumpApp(tester);
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    backend.responses['/auth/register'] = (409, {'statusCode': 409, 'code': 'email_taken', 'message': 'An account with this email already exists. Sign in instead.'});
    await tester.enterText(find.byKey(const Key('register.name')), 'Asha');
    await tester.enterText(find.byKey(const Key('register.email')), 'asha@example.com');
    await tester.enterText(find.byKey(const Key('register.password')), 'sturdy-password-1');
    await tester.tap(find.byKey(const Key('register.submit')));
    await tester.pumpAndSettle();
    expect(find.text('An account with this email already exists. Sign in instead.'), findsOneWidget);
  });

  testWidgets('a stored session is restored, and signing out returns to sign-in', (tester) async {
    final (backend, store) = await pumpApp(tester, stored: signedInTokens);
    expect(find.text('Hi, Asha'), findsOneWidget);
    await openProfile(tester);
    backend.responses['/auth/logout'] = (204, null);
    await tester.ensureVisible(find.byKey(const Key('profile.signOut')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('profile.signOut')));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(await store.read(), isNull);
  });

  testWidgets('signing out never waits on the network; the server session is revoked in the background', (tester) async {
    final (backend, store) = await pumpApp(tester, stored: signedInTokens);
    await openProfile(tester);
    backend.responses['/auth/logout'] = (204, null);
    await tester.ensureVisible(find.byKey(const Key('profile.signOut')));
    await tester.pumpAndSettle();
    backend.latency = const Duration(seconds: 30); // a very slow network
    await tester.tap(find.byKey(const Key('profile.signOut')));
    await tester.pump(const Duration(milliseconds: 500)); // far less than the network delay
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Welcome back'), findsOneWidget);
    expect(await store.read(), isNull);
    await tester.pump(const Duration(seconds: 31)); // the background revoke completes later
    expect(backend.log.last, 'POST /auth/logout');
  });

  testWidgets('sign out of all devices reports failure when offline and keeps the session', (tester) async {
    final (backend, store) = await pumpApp(tester, stored: signedInTokens);
    await openProfile(tester);
    backend.offline = true;
    await tester.ensureVisible(find.text('Sign out of all devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out of all devices'));
    await tester.pumpAndSettle();
    expect(find.text('Sign out of all devices?'), findsOneWidget); // confirmation names the action
    await tester.tap(find.text('Sign out everywhere'));
    await tester.pumpAndSettle();
    expect(find.textContaining('other devices couldn’t be signed out'), findsOneWidget);
    expect(await store.read(), isNotNull);
  });

  testWidgets('offline on launch shows the offline state, not stale data', (tester) async {
    final backend = FakeBackend()..offline = true;
    final (_, store) = await pumpApp(tester, stored: signedInTokens, backend: backend);
    expect(find.text('You’re offline'), findsOneWidget);
    expect(find.text('Available to spend'), findsNothing); // nothing financial shown unverified
    expect(await store.read(), isNotNull); // session kept for when the connection returns
    backend.offline = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Hi, Asha'), findsOneWidget);
  });
}
