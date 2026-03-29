# Flutter SDK Reference Guide

This comprehensive guide covers advanced Flutter patterns, platform-specific development, and deployment strategies for iOS, Android, and Web.

---

## Table of Contents

1. [Complete CLI Reference](#complete-cli-reference)
2. [Project Configuration](#project-configuration)
3. [Widget Architecture](#widget-architecture)
4. [State Management Deep Dive](#state-management-deep-dive)
5. [Navigation Patterns](#navigation-patterns)
6. [Platform-Specific Development](#platform-specific-development)
7. [Testing Strategies](#testing-strategies)
8. [Performance Optimization](#performance-optimization)
9. [Accessibility](#accessibility)
10. [Internationalization](#internationalization)
11. [iOS Development](#ios-development)
12. [Android Development](#android-development)
13. [Web Development](#web-development)
14. [CI/CD Integration](#cicd-integration)
15. [Troubleshooting](#troubleshooting)

---

## Complete CLI Reference

### Project Creation Options

```bash
# Basic project
flutter create my_app

# With organization
flutter create my_app --org com.example

# Specific platforms only
flutter create my_app --platforms ios,android,web

# Package (library)
flutter create --template=package my_package

# Plugin (native code)
flutter create --template=plugin my_plugin

# Module (add-to-app)
flutter create --template=module my_module
```

### Build Command Details

**Android APK**:
```bash
# Debug APK
flutter build apk --debug

# Release APK
flutter build apk --release

# Split by ABI (smaller APKs)
flutter build apk --split-per-abi

# Specific flavor
flutter build apk --flavor production --release

# With obfuscation
flutter build apk --release --obfuscate --split-debug-info=build/debug-info
```

**Android App Bundle (AAB)**:
```bash
# For Play Store (recommended)
flutter build appbundle --release

# With flavor
flutter build appbundle --flavor production --release
```

**iOS**:
```bash
# Debug (no codesign for CI)
flutter build ios --debug --no-codesign

# Release (requires signing)
flutter build ios --release

# Build IPA for distribution
flutter build ipa --release --export-options-plist=ExportOptions.plist
```

**Web**:
```bash
# Release build
flutter build web --release

# With specific renderer
flutter build web --web-renderer canvaskit  # Better quality
flutter build web --web-renderer html       # Smaller size
flutter build web --web-renderer auto       # Auto-detect

# Disable PWA service worker
flutter build web --pwa-strategy none

# With base href (for subdirectory hosting)
flutter build web --base-href /my-app/
```

### Run Command Options

```bash
# Run on specific device
flutter run -d <device_id>

# Run in release mode
flutter run --release -d <device_id>

# Run in profile mode (for performance analysis)
flutter run --profile -d <device_id>

# Run with specific flavor
flutter run --flavor development -d <device_id>

# Run with dart defines
flutter run --dart-define=API_URL=https://api.example.com

# Run multiple instances
flutter run -d all
```

### Package Management

```bash
# Get dependencies
flutter pub get

# Upgrade dependencies
flutter pub upgrade

# Upgrade to major versions
flutter pub upgrade --major-versions

# Check outdated
flutter pub outdated

# Add dependency
flutter pub add http

# Add dev dependency
flutter pub add --dev mockito

# Remove dependency
flutter pub remove http

# Run build_runner
flutter pub run build_runner build --delete-conflicting-outputs
```

---

## Project Configuration

### pubspec.yaml Structure

```yaml
name: my_app
description: A Flutter application
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

  # State management
  flutter_riverpod: ^2.5.0
  riverpod_annotation: ^2.3.0

  # Navigation
  go_router: ^14.0.0

  # Networking
  dio: ^5.4.0

  # Local storage
  shared_preferences: ^2.2.0
  hive_flutter: ^1.1.0

  # UI
  flutter_svg: ^2.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

  # Code generation
  build_runner: ^2.4.0
  riverpod_generator: ^2.4.0
  freezed: ^2.5.0
  json_serializable: ^6.8.0

  # Testing
  mocktail: ^1.0.0
  golden_toolkit: ^0.15.0

flutter:
  uses-material-design: true
  generate: true  # For l10n

  assets:
    - assets/images/
    - assets/icons/

  fonts:
    - family: CustomFont
      fonts:
        - asset: assets/fonts/CustomFont-Regular.ttf
        - asset: assets/fonts/CustomFont-Bold.ttf
          weight: 700
```

### analysis_options.yaml

```yaml
include: package:flutter_lints/flutter.yaml

analyzer:
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true
  errors:
    missing_return: error
    missing_required_param: error
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"

linter:
  rules:
    - always_declare_return_types
    - avoid_dynamic_calls
    - avoid_empty_else
    - avoid_print
    - avoid_type_to_string
    - cancel_subscriptions
    - close_sinks
    - prefer_const_constructors
    - prefer_const_declarations
    - prefer_final_locals
    - require_trailing_commas
    - unawaited_futures
    - unnecessary_await_in_return
```

### Flavors Configuration

**Android** (`android/app/build.gradle`):
```groovy
android {
    flavorDimensions "environment"
    productFlavors {
        development {
            dimension "environment"
            applicationIdSuffix ".dev"
            versionNameSuffix "-dev"
        }
        staging {
            dimension "environment"
            applicationIdSuffix ".staging"
            versionNameSuffix "-staging"
        }
        production {
            dimension "environment"
        }
    }
}
```

**iOS** (Xcode schemes required):
1. Create schemes for each flavor in Xcode
2. Configure build settings per scheme
3. Use different bundle identifiers

---

## Widget Architecture

### Composition Patterns

**Compound Widgets**:
```dart
class DataTable extends StatelessWidget {
  final List<DataColumn> columns;
  final List<DataRow> rows;

  const DataTable({
    required this.columns,
    required this.rows,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        DataTable.Header(columns: columns),
        Expanded(
          child: ListView.builder(
            itemCount: rows.length,
            itemBuilder: (context, index) => rows[index],
          ),
        ),
      ],
    );
  }

  // Nested widget for compound pattern
  static Widget header({required List<DataColumn> columns}) =>
      DataTableHeader(columns: columns);
}
```

**Builder Pattern**:
```dart
class AsyncBuilder<T> extends StatelessWidget {
  final Future<T> future;
  final Widget Function(BuildContext, T) builder;
  final Widget Function(BuildContext, Object)? errorBuilder;
  final Widget? loading;

  const AsyncBuilder({
    required this.future,
    required this.builder,
    this.errorBuilder,
    this.loading,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return errorBuilder?.call(context, snapshot.error!) ??
              Text('Error: ${snapshot.error}');
        }
        if (!snapshot.hasData) {
          return loading ?? const CircularProgressIndicator();
        }
        return builder(context, snapshot.data as T);
      },
    );
  }
}
```

### Hook Widgets (flutter_hooks)

```dart
class SearchableList extends HookConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final searchController = useTextEditingController();
    final debouncer = useDebouncer(duration: const Duration(milliseconds: 300));
    final items = ref.watch(itemsProvider);

    useEffect(() {
      searchController.addListener(() {
        debouncer.run(() {
          ref.read(searchQueryProvider.notifier).state = searchController.text;
        });
      });
      return null;
    }, [searchController]);

    return Column(
      children: [
        TextField(controller: searchController),
        Expanded(
          child: items.when(
            data: (data) => ListView.builder(
              itemCount: data.length,
              itemBuilder: (context, index) => ListTile(title: Text(data[index])),
            ),
            loading: () => const CircularProgressIndicator(),
            error: (e, s) => Text('Error: $e'),
          ),
        ),
      ],
    );
  }
}
```

---

## State Management Deep Dive

### Riverpod Architecture

**Provider Types**:
```dart
// Simple value
final configProvider = Provider<AppConfig>((ref) => AppConfig());

// Future
final userProvider = FutureProvider<User>((ref) async {
  final api = ref.watch(apiProvider);
  return api.getCurrentUser();
});

// Stream
final messagesProvider = StreamProvider<List<Message>>((ref) {
  final socket = ref.watch(socketProvider);
  return socket.messages;
});

// State notifier (mutable)
@riverpod
class Cart extends _$Cart {
  @override
  List<CartItem> build() => [];

  void addItem(CartItem item) {
    state = [...state, item];
  }

  void removeItem(String itemId) {
    state = state.where((item) => item.id != itemId).toList();
  }

  void clear() => state = [];
}

// Async notifier
@riverpod
class Auth extends _$Auth {
  @override
  FutureOr<User?> build() async {
    return _checkStoredCredentials();
  }

  Future<void> login(String email, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final user = await ref.read(authServiceProvider).login(email, password);
      return user;
    });
  }

  Future<void> logout() async {
    await ref.read(authServiceProvider).logout();
    state = const AsyncData(null);
  }
}
```

**Provider Modifiers**:
```dart
// Family - parameterized providers
@riverpod
Future<User> userById(UserByIdRef ref, String userId) async {
  return ref.watch(apiProvider).getUser(userId);
}

// AutoDispose - automatic cleanup
@riverpod
Stream<List<Notification>> notifications(NotificationsRef ref) {
  final controller = StreamController<List<Notification>>();
  ref.onDispose(controller.close);
  return controller.stream;
}
```

### Bloc Architecture

**Complete Bloc Example**:
```dart
// Events
sealed class ProductEvent {}

class LoadProducts extends ProductEvent {}
class RefreshProducts extends ProductEvent {}
class FilterProducts extends ProductEvent {
  final String category;
  FilterProducts(this.category);
}

// States
sealed class ProductState {}

class ProductInitial extends ProductState {}
class ProductLoading extends ProductState {}
class ProductLoaded extends ProductState {
  final List<Product> products;
  final String? activeFilter;
  ProductLoaded(this.products, {this.activeFilter});
}
class ProductError extends ProductState {
  final String message;
  ProductError(this.message);
}

// Bloc
class ProductBloc extends Bloc<ProductEvent, ProductState> {
  final ProductRepository repository;

  ProductBloc(this.repository) : super(ProductInitial()) {
    on<LoadProducts>(_onLoad);
    on<RefreshProducts>(_onRefresh);
    on<FilterProducts>(_onFilter);
  }

  Future<void> _onLoad(LoadProducts event, Emitter<ProductState> emit) async {
    emit(ProductLoading());
    try {
      final products = await repository.getProducts();
      emit(ProductLoaded(products));
    } catch (e) {
      emit(ProductError(e.toString()));
    }
  }

  Future<void> _onRefresh(RefreshProducts event, Emitter<ProductState> emit) async {
    final current = state;
    try {
      final products = await repository.getProducts();
      emit(ProductLoaded(
        products,
        activeFilter: current is ProductLoaded ? current.activeFilter : null,
      ));
    } catch (e) {
      // Keep current state on refresh failure
      if (current is ProductLoaded) return;
      emit(ProductError(e.toString()));
    }
  }

  Future<void> _onFilter(FilterProducts event, Emitter<ProductState> emit) async {
    final current = state;
    if (current is ProductLoaded) {
      final filtered = current.products
          .where((p) => p.category == event.category)
          .toList();
      emit(ProductLoaded(filtered, activeFilter: event.category));
    }
  }
}
```

---

## Navigation Patterns

### GoRouter Advanced Configuration

```dart
final router = GoRouter(
  initialLocation: '/',
  debugLogDiagnostics: true,
  refreshListenable: authStateNotifier,
  redirect: (context, state) {
    final isAuthenticated = authStateNotifier.isAuthenticated;
    final isLoggingIn = state.matchedLocation == '/login';

    if (!isAuthenticated && !isLoggingIn) return '/login';
    if (isAuthenticated && isLoggingIn) return '/';
    return null;
  },
  routes: [
    ShellRoute(
      builder: (context, state, child) => MainShell(child: child),
      routes: [
        GoRoute(
          path: '/',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: HomeScreen(),
          ),
          routes: [
            GoRoute(
              path: 'product/:id',
              builder: (context, state) {
                final id = state.pathParameters['id']!;
                final extra = state.extra as Product?;
                return ProductScreen(productId: id, product: extra);
              },
            ),
          ],
        ),
        GoRoute(
          path: '/cart',
          pageBuilder: (context, state) => CustomTransitionPage(
            child: const CartScreen(),
            transitionsBuilder: (context, animation, secondaryAnimation, child) {
              return SlideTransition(
                position: Tween(
                  begin: const Offset(1, 0),
                  end: Offset.zero,
                ).animate(animation),
                child: child,
              );
            },
          ),
        ),
      ],
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginScreen(),
    ),
  ],
  errorBuilder: (context, state) => ErrorScreen(error: state.error),
);
```

### Deep Linking Setup

**Universal Links (iOS)**:
1. Add Associated Domains capability
2. Add `apple-app-site-association` file to web server
3. Configure `Info.plist`:

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
<key>FlutterDeepLinkingEnabled</key>
<true/>
```

**App Links (Android)**:
1. Add `assetlinks.json` to web server
2. Configure `AndroidManifest.xml`:

```xml
<activity>
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="example.com" />
  </intent-filter>
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="myapp" />
  </intent-filter>
</activity>
```

---

## Platform-Specific Development

### Platform Channels

**Dart Side**:
```dart
class NativeBridge {
  static const _channel = MethodChannel('com.example.app/native');
  static const _eventChannel = EventChannel('com.example.app/events');

  Future<String> getPlatformVersion() async {
    final version = await _channel.invokeMethod<String>('getPlatformVersion');
    return version ?? 'Unknown';
  }

  Future<Map<String, dynamic>> getDeviceInfo() async {
    final result = await _channel.invokeMethod<Map>('getDeviceInfo');
    return Map<String, dynamic>.from(result ?? {});
  }

  Stream<int> get batteryLevel {
    return _eventChannel.receiveBroadcastStream().map((event) => event as int);
  }
}
```

**iOS Side (Swift)**:
```swift
@UIApplicationMain
class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController
    let channel = FlutterMethodChannel(
      name: "com.example.app/native",
      binaryMessenger: controller.binaryMessenger
    )

    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "getPlatformVersion":
        result("iOS " + UIDevice.current.systemVersion)
      case "getDeviceInfo":
        result([
          "model": UIDevice.current.model,
          "name": UIDevice.current.name
        ])
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
```

**Android Side (Kotlin)**:
```kotlin
class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.example.app/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getPlatformVersion" -> {
                        result.success("Android ${android.os.Build.VERSION.RELEASE}")
                    }
                    "getDeviceInfo" -> {
                        result.success(mapOf(
                            "model" to android.os.Build.MODEL,
                            "manufacturer" to android.os.Build.MANUFACTURER
                        ))
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
```

---

## Testing Strategies

### Widget Testing

```dart
void main() {
  group('LoginForm', () {
    late MockAuthService mockAuthService;

    setUp(() {
      mockAuthService = MockAuthService();
    });

    testWidgets('shows validation errors for empty fields', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: ProviderScope(
            overrides: [
              authServiceProvider.overrideWithValue(mockAuthService),
            ],
            child: const LoginForm(),
          ),
        ),
      );

      await tester.tap(find.text('Login'));
      await tester.pump();

      expect(find.text('Email is required'), findsOneWidget);
      expect(find.text('Password is required'), findsOneWidget);
    });

    testWidgets('calls login on valid submission', (tester) async {
      when(() => mockAuthService.login(any(), any()))
          .thenAnswer((_) async => User(id: '1', email: 'test@example.com'));

      await tester.pumpWidget(
        MaterialApp(
          home: ProviderScope(
            overrides: [
              authServiceProvider.overrideWithValue(mockAuthService),
            ],
            child: const LoginForm(),
          ),
        ),
      );

      await tester.enterText(find.byKey(const Key('email')), 'test@example.com');
      await tester.enterText(find.byKey(const Key('password')), 'password123');
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      verify(() => mockAuthService.login('test@example.com', 'password123')).called(1);
    });
  });
}
```

### Integration Testing

```dart
// integration_test/app_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('end-to-end test', () {
    testWidgets('complete purchase flow', (tester) async {
      app.main();
      await tester.pumpAndSettle();

      // Login
      await tester.enterText(find.byKey(const Key('email')), 'test@example.com');
      await tester.enterText(find.byKey(const Key('password')), 'password');
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      // Navigate to product
      await tester.tap(find.text('Products'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Product 1'));
      await tester.pumpAndSettle();

      // Add to cart
      await tester.tap(find.text('Add to Cart'));
      await tester.pumpAndSettle();

      // Verify cart
      await tester.tap(find.byIcon(Icons.shopping_cart));
      await tester.pumpAndSettle();
      expect(find.text('Product 1'), findsOneWidget);
    });
  });
}
```

Run integration tests:
```bash
flutter test integration_test/app_test.dart -d <device_id>
```

---

## Accessibility

### Semantic Widgets

```dart
class AccessibleCard extends StatelessWidget {
  final String title;
  final String description;
  final VoidCallback onTap;

  const AccessibleCard({
    required this.title,
    required this.description,
    required this.onTap,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$title. $description. Double tap to open.',
      child: MergeSemantics(
        child: Card(
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ExcludeSemantics(
                    child: Text(title, style: Theme.of(context).textTheme.titleLarge),
                  ),
                  const SizedBox(height: 8),
                  ExcludeSemantics(
                    child: Text(description),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

---

## CI/CD Integration

### GitHub Actions - Complete Workflow

```yaml
name: Flutter CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  FLUTTER_VERSION: "3.24.0"

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - run: flutter pub get
      - run: flutter analyze --fatal-infos

  test:
    runs-on: ubuntu-latest
    needs: analyze
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - run: flutter pub get
      - run: flutter test --coverage

      - uses: codecov/codecov-action@v4
        with:
          files: coverage/lcov.info

  build-android:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - run: flutter pub get
      - run: flutter build appbundle --release

      - uses: actions/upload-artifact@v4
        with:
          name: android-release
          path: build/app/outputs/bundle/release/

  build-ios:
    runs-on: macos-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - run: flutter pub get
      - run: flutter build ios --release --no-codesign

      - uses: actions/upload-artifact@v4
        with:
          name: ios-release
          path: build/ios/iphoneos/

  build-web:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - run: flutter pub get
      - run: flutter build web --release

      - uses: actions/upload-artifact@v4
        with:
          name: web-release
          path: build/web/
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| CocoaPods version mismatch | `cd ios && pod install --repo-update` |
| Gradle build failure | Check Java version, run `flutter clean` |
| iOS signing issues | Check provisioning profiles in Xcode |
| Web CORS errors | Configure server headers or use proxy |
| Hot reload not working | Check for syntax errors, restart app |
| Dependencies conflict | Use `dependency_overrides` in pubspec.yaml |

### Debug Commands

```bash
# Full diagnostic
flutter doctor -v

# Clean build
flutter clean && flutter pub get

# iOS specific
cd ios && pod deintegrate && pod install

# Android specific
cd android && ./gradlew clean

# Verbose run
flutter run -v

# Dump app structure
flutter analyze --suggestions
```

---

## Sources

- [Flutter Documentation](https://docs.flutter.dev)
- [Dart Language](https://dart.dev)
- [Riverpod Documentation](https://riverpod.dev)
- [Bloc Library](https://bloclibrary.dev)
- [GoRouter](https://pub.dev/packages/go_router)
- [Flutter Testing](https://docs.flutter.dev/testing)
