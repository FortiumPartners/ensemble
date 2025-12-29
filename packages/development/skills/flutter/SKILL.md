---
name: flutter
description: Flutter SDK for cross-platform development targeting iOS, Android, and Web. Use for widget architecture, state management, platform channels, and multi-platform deployment.
version: 1.0.0
allowed-tools: Bash, Read, Glob, Grep
---

# Flutter SDK Skill

## Quick Reference

Flutter is Google's UI toolkit for building natively compiled applications for mobile (iOS, Android), web, and desktop from a single Dart codebase.

---

## Critical: Avoiding Interactive Mode

**Flutter CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | WRONG (Interactive) | CORRECT (Non-Interactive) |
|---------|---------------------|---------------------------|
| Create project | `flutter create` (prompts) | `flutter create my_app --org com.example` |
| Run app | `flutter run` (prompts for device) | `flutter run -d <device_id>` |
| Build | `flutter build` (may prompt) | `flutter build apk --release` |
| Emulators | `flutter emulators --launch` | `flutter emulators --launch <emulator_id>` |

**Always include**:
- `-d <device_id>` for device selection (use `flutter devices` to list)
- Explicit build targets (`apk`, `appbundle`, `ios`, `web`)
- `--no-pub` when pub get is not needed
- `--suppress-analytics` in CI/CD environments

**Never use in Claude Code**:
- Commands that open GUI (Android Studio, Xcode)
- Interactive device selection prompts
- Commands without explicit targets

---

## Prerequisites

### Installation Verification

```bash
flutter --version
# Expected: Flutter 3.x.x

flutter doctor
# Check all requirements are met

flutter doctor -v
# Verbose output for troubleshooting
```

### Environment Setup

```bash
# Check available devices
flutter devices

# Check available emulators
flutter emulators

# Launch specific emulator (non-interactive)
flutter emulators --launch <emulator_id>
```

---

## CLI Decision Tree

### What do you need to do?

```
Project Setup
├── Create new project ────────────────► flutter create <name> --org <org>
├── Get dependencies ──────────────────► flutter pub get
├── Upgrade dependencies ──────────────► flutter pub upgrade
├── Clean build artifacts ─────────────► flutter clean
└── Check project health ──────────────► flutter doctor

Development
├── Run on device ─────────────────────► flutter run -d <device_id>
├── Run in debug mode ─────────────────► flutter run --debug -d <device_id>
├── Run in release mode ───────────────► flutter run --release -d <device_id>
├── Hot reload ────────────────────────► (press 'r' in terminal while running)
├── Hot restart ───────────────────────► (press 'R' in terminal while running)
└── Attach to running app ─────────────► flutter attach -d <device_id>

Building
├── Build Android APK ─────────────────► flutter build apk --release
├── Build Android App Bundle ──────────► flutter build appbundle --release
├── Build iOS ─────────────────────────► flutter build ios --release
├── Build iOS (no codesign) ───────────► flutter build ios --release --no-codesign
├── Build Web ─────────────────────────► flutter build web --release
└── Build with flavor ─────────────────► flutter build apk --flavor <name>

Testing
├── Run all tests ─────────────────────► flutter test
├── Run specific test file ────────────► flutter test test/widget_test.dart
├── Run with coverage ─────────────────► flutter test --coverage
├── Run integration tests ─────────────► flutter test integration_test/
└── Run golden tests ──────────────────► flutter test --update-goldens

Code Quality
├── Analyze code ──────────────────────► flutter analyze
├── Format code ───────────────────────► dart format .
├── Fix lint issues ───────────────────► dart fix --apply
└── Check outdated packages ───────────► flutter pub outdated

Platform-Specific
├── Enable web support ────────────────► flutter config --enable-web
├── Enable desktop support ────────────► flutter config --enable-<platform>-desktop
├── Add iOS permissions ───────────────► Edit ios/Runner/Info.plist
├── Add Android permissions ───────────► Edit android/app/src/main/AndroidManifest.xml
└── Generate l10n ─────────────────────► flutter gen-l10n

Debugging
├── View logs ─────────────────────────► flutter logs -d <device_id>
├── Take screenshot ───────────────────► flutter screenshot -d <device_id>
├── Symbolize crash ───────────────────► flutter symbolize --input=<file>
└── Profile performance ───────────────► flutter run --profile -d <device_id>
```

---

## Command Reference

### Project Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `flutter create` | Create new project | `--org`, `--template`, `--platforms` |
| `flutter clean` | Delete build/ and .dart_tool/ | - |
| `flutter pub get` | Get dependencies | `--offline`, `--no-precompile` |
| `flutter pub upgrade` | Upgrade dependencies | `--major-versions` |
| `flutter pub outdated` | Check outdated packages | `--json` |

### Run Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `flutter run` | Run app on device | `-d <device>`, `--release`, `--profile`, `--debug` |
| `flutter attach` | Attach to running app | `-d <device>` |
| `flutter install` | Install app on device | `-d <device>` |
| `flutter logs` | Show device logs | `-d <device>` |

### Build Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `flutter build apk` | Build Android APK | `--release`, `--debug`, `--split-per-abi` |
| `flutter build appbundle` | Build Android AAB | `--release` (recommended for Play Store) |
| `flutter build ios` | Build iOS app | `--release`, `--no-codesign` |
| `flutter build ipa` | Build iOS IPA | `--release`, `--export-options-plist` |
| `flutter build web` | Build web app | `--release`, `--web-renderer`, `--pwa-strategy` |

### Test Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `flutter test` | Run unit/widget tests | `--coverage`, `--update-goldens` |
| `flutter drive` | Run integration tests | `-d <device>`, `--driver` |
| `flutter analyze` | Static analysis | `--fatal-infos`, `--fatal-warnings` |

### Device Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `flutter devices` | List connected devices | `-d <device>` |
| `flutter emulators` | List/launch emulators | `--launch <id>`, `--create` |
| `flutter doctor` | Check environment | `-v` (verbose) |

---

## Project Structure

```
my_app/
├── lib/
│   ├── main.dart                 # Entry point
│   ├── app.dart                  # App widget
│   ├── features/                 # Feature modules
│   │   └── auth/
│   │       ├── data/             # Repositories, data sources
│   │       ├── domain/           # Entities, use cases
│   │       └── presentation/     # Widgets, providers
│   ├── core/                     # Shared utilities
│   │   ├── constants/
│   │   ├── extensions/
│   │   ├── theme/
│   │   └── utils/
│   └── l10n/                     # Localization
├── test/                         # Unit and widget tests
├── integration_test/             # Integration tests
├── android/                      # Android platform code
├── ios/                          # iOS platform code
├── web/                          # Web platform code
├── pubspec.yaml                  # Dependencies
├── analysis_options.yaml         # Lint rules
└── l10n.yaml                     # Localization config
```

---

## State Management

### Riverpod (Recommended for 2025)

```dart
// Provider definition
final userProvider = FutureProvider<User>((ref) async {
  final repository = ref.watch(userRepositoryProvider);
  return repository.getCurrentUser();
});

// Notifier for mutable state
@riverpod
class Counter extends _$Counter {
  @override
  int build() => 0;

  void increment() => state++;
  void decrement() => state--;
}

// Usage in widget
class CounterWidget extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);
    return Text('Count: $count');
  }
}
```

### Provider (Simple apps)

```dart
// ChangeNotifier
class CartNotifier extends ChangeNotifier {
  final List<Item> _items = [];
  List<Item> get items => List.unmodifiable(_items);

  void addItem(Item item) {
    _items.add(item);
    notifyListeners();
  }
}

// Provider setup
MultiProvider(
  providers: [
    ChangeNotifierProvider(create: (_) => CartNotifier()),
  ],
  child: MyApp(),
)

// Usage
final cart = context.watch<CartNotifier>();
```

### Bloc (Enterprise apps)

```dart
// Events
sealed class AuthEvent {}
class LoginRequested extends AuthEvent {
  final String email, password;
  LoginRequested(this.email, this.password);
}

// States
sealed class AuthState {}
class AuthInitial extends AuthState {}
class AuthLoading extends AuthState {}
class AuthSuccess extends AuthState {
  final User user;
  AuthSuccess(this.user);
}
class AuthFailure extends AuthState {
  final String message;
  AuthFailure(this.message);
}

// Bloc
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc() : super(AuthInitial()) {
    on<LoginRequested>(_onLoginRequested);
  }

  Future<void> _onLoginRequested(
    LoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      final user = await authRepository.login(event.email, event.password);
      emit(AuthSuccess(user));
    } catch (e) {
      emit(AuthFailure(e.toString()));
    }
  }
}
```

---

## Widget Patterns

### StatelessWidget

```dart
class UserCard extends StatelessWidget {
  final User user;
  final VoidCallback? onTap;

  const UserCard({
    required this.user,
    this.onTap,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(backgroundImage: NetworkImage(user.avatarUrl)),
        title: Text(user.name),
        subtitle: Text(user.email),
        onTap: onTap,
      ),
    );
  }
}
```

### StatefulWidget

```dart
class SearchField extends StatefulWidget {
  final ValueChanged<String> onChanged;

  const SearchField({required this.onChanged, super.key});

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  final _controller = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      widget.onChanged(value);
    });
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      onChanged: _onSearchChanged,
      decoration: const InputDecoration(
        hintText: 'Search...',
        prefixIcon: Icon(Icons.search),
      ),
    );
  }
}
```

---

## Platform-Specific Code

### Conditional Imports

```dart
// lib/utils/platform_utils.dart
export 'platform_utils_stub.dart'
    if (dart.library.io) 'platform_utils_io.dart'
    if (dart.library.html) 'platform_utils_web.dart';
```

### Platform Checks

```dart
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;

Widget build(BuildContext context) {
  if (kIsWeb) {
    return WebSpecificWidget();
  }
  if (Platform.isIOS) {
    return CupertinoWidget();
  }
  if (Platform.isAndroid) {
    return MaterialWidget();
  }
  return DefaultWidget();
}
```

### Platform Channels (Native Integration)

```dart
// Dart side
class BatteryLevel {
  static const platform = MethodChannel('com.example.app/battery');

  Future<int> getBatteryLevel() async {
    try {
      final int result = await platform.invokeMethod('getBatteryLevel');
      return result;
    } on PlatformException catch (e) {
      throw Exception('Failed to get battery level: ${e.message}');
    }
  }
}
```

---

## Navigation

### GoRouter (Recommended)

```dart
final router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        GoRoute(
          path: 'user/:id',
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            return UserScreen(userId: id);
          },
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => ErrorScreen(error: state.error),
);

// Usage
context.go('/user/123');
context.push('/user/123');
context.pop();
```

### Deep Linking Configuration

**iOS** (`ios/Runner/Info.plist`):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>myapp</string>
    </array>
  </dict>
</array>
```

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" />
</intent-filter>
```

---

## Web-Specific Considerations

### Build Renderers

```bash
# CanvasKit (default) - better fidelity, larger size
flutter build web --web-renderer canvaskit

# HTML - smaller size, some limitations
flutter build web --web-renderer html

# Auto - CanvasKit on desktop, HTML on mobile
flutter build web --web-renderer auto
```

### SEO Considerations

- Flutter web renders to canvas - limited SEO by default
- Best for: Internal tools, dashboards, PWAs, authenticated apps
- For SEO-critical content: Consider server-side rendering or static HTML

### PWA Configuration

```bash
# Disable service worker (if not needed)
flutter build web --pwa-strategy none
```

---

## Testing

### Widget Tests

```dart
void main() {
  testWidgets('Counter increments', (tester) async {
    await tester.pumpWidget(const MyApp());

    expect(find.text('0'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();

    expect(find.text('1'), findsOneWidget);
  });
}
```

### Provider/Riverpod Testing

```dart
void main() {
  testWidgets('Shows user data', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          userProvider.overrideWith((ref) => FakeUserNotifier()),
        ],
        child: const MyApp(),
      ),
    );

    await tester.pumpAndSettle();
    expect(find.text('John Doe'), findsOneWidget);
  });
}
```

### Golden Tests

```dart
void main() {
  testWidgets('Button matches golden', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: MyButton(label: 'Submit')),
    );

    await expectLater(
      find.byType(MyButton),
      matchesGoldenFile('goldens/my_button.png'),
    );
  });
}

// Update goldens: flutter test --update-goldens
```

---

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `No connected devices` | No device/emulator | Run `flutter devices`, start emulator |
| `Gradle build failed` | Android SDK issue | Run `flutter doctor`, check Android Studio |
| `CocoaPods not installed` | iOS dependency | `sudo gem install cocoapods` |
| `pub get failed` | Network or version conflict | Check `pubspec.yaml`, run `flutter clean` |
| `Null check operator used on null` | Null safety violation | Use `?.` or null checks |

### Debug Commands

```bash
# Verbose output
flutter run -v

# Check for issues
flutter doctor -v

# Clean and rebuild
flutter clean && flutter pub get && flutter run
```

---

## CI/CD Integration

### Required Environment

```yaml
env:
  FLUTTER_VERSION: "3.24.0"  # Pin version for reproducibility
```

### GitHub Actions Pattern

```yaml
- uses: subosito/flutter-action@v2
  with:
    flutter-version: ${{ env.FLUTTER_VERSION }}
    channel: stable
    cache: true

- run: flutter pub get
- run: flutter analyze
- run: flutter test --coverage
- run: flutter build apk --release
```

---

## Auto-Detection Triggers

This skill auto-loads when Flutter context is detected:

**File-based triggers**:
- `pubspec.yaml` with `flutter` dependency
- `lib/main.dart` present
- `.dart` files in project
- `android/` and `ios/` directories

**Context-based triggers**:
- User mentions "Flutter"
- User runs flutter CLI commands
- Widget development discussions
- Cross-platform mobile development

---

## Agent Integration

### Compatible Agents

| Agent | Use Case |
|-------|----------|
| `mobile-developer` | Primary agent for Flutter development |
| `deep-debugger` | Performance profiling, crash analysis |
| `code-reviewer` | Dart code review, accessibility audit |
| `deployment-orchestrator` | App store submissions |

### Handoff Patterns

**To Deep-Debugger**:
```yaml
When:
  - Performance profiling needed
  - Crash analysis required
  - Memory leak investigation
  - Platform-specific bugs

Provide:
  - flutter logs output
  - Stack traces
  - Device information (flutter devices)
```

---

## Sources

- [Flutter CLI Reference](https://docs.flutter.dev/reference/flutter-cli)
- [Flutter Documentation](https://docs.flutter.dev)
- [Effective Dart](https://dart.dev/effective-dart)
- [Flutter State Management](https://docs.flutter.dev/data-and-backend/state-mgmt)
- [Flutter Web Deployment](https://docs.flutter.dev/deployment/web)
