# Flutter SDK Skill

**Version**: 1.0.0 | **Category**: Mobile Development | **Auto-Detection**: Yes

---

## Purpose

This skill provides Claude Code agents with comprehensive knowledge of the Flutter SDK for:

- **Cross-Platform Development**: Build for iOS, Android, and Web from single codebase
- **Widget Architecture**: Stateless, Stateful, and Consumer widgets
- **State Management**: Riverpod, Provider, Bloc patterns
- **Platform Integration**: Platform channels, native modules
- **Navigation**: GoRouter, deep linking, URL-based routing
- **Testing**: Widget tests, integration tests, golden tests
- **Deployment**: App Store, Play Store, and web hosting

---

## Critical: Avoiding Interactive Mode

**Flutter CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | Interactive | Non-Interactive |
|---------|-------------|-----------------|
| `flutter run` | Prompts for device | `flutter run -d <device_id>` |
| `flutter create` | May prompt | `flutter create my_app --org com.example` |
| `flutter emulators --launch` | Prompts for emulator | `flutter emulators --launch <emulator_id>` |

**Always include**:
- `-d <device_id>` for device selection
- Explicit build targets (`apk`, `appbundle`, `ios`, `web`)
- `--suppress-analytics` in CI/CD environments

---

## File Organization

| File | Size | Purpose |
|------|------|---------|
| `SKILL.md` | ~22KB | Quick reference for immediate use |
| `REFERENCE.md` | ~30KB | Comprehensive guide with advanced patterns |
| `README.md` | ~4KB | This file - architecture overview |
| `examples/ci-cd.example.yaml` | ~6KB | GitHub Actions deployment examples |

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

### Primary Agent

| Agent | Role |
|-------|------|
| `mobile-developer` | Primary agent - loads this skill automatically |

### Supporting Agents

| Agent | Use Case |
|-------|----------|
| `deep-debugger` | Performance profiling, crash analysis |
| `code-reviewer` | Dart code review, accessibility audit |
| `deployment-orchestrator` | App store submissions |
| `infrastructure-developer` | Firebase, backend services |

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
  - Device information
```

**From Deep-Debugger**:
```yaml
When:
  - Issue identified as widget/state problem
  - Need code fix implementation
  - Platform channel issues identified
```

---

## Key Capabilities

### CLI Commands (25+)

```
Project:     create, clean, pub get, pub upgrade, pub outdated
Development: run, attach, install, logs
Building:    build apk, build appbundle, build ios, build ipa, build web
Testing:     test, drive, analyze
Debugging:   logs, screenshot, symbolize
Config:      doctor, devices, emulators, config, channel
```

### State Management Support

| Solution | Best For | Complexity |
|----------|----------|------------|
| Riverpod | Most apps (2025 recommended) | Medium |
| Provider | Simple apps | Low |
| Bloc | Enterprise, large teams | High |

### Platform Targets

| Platform | Build Command | Output |
|----------|---------------|--------|
| Android APK | `flutter build apk` | `.apk` file |
| Android Bundle | `flutter build appbundle` | `.aab` file (Play Store) |
| iOS | `flutter build ios` | Xcode project |
| iOS IPA | `flutter build ipa` | `.ipa` file |
| Web | `flutter build web` | Static files |

---

## Web Considerations

Flutter Web is best suited for:
- Internal tools and dashboards
- Authenticated applications
- Progressive Web Apps (PWAs)
- Apps where SEO is not critical

For SEO-critical content-focused sites, consider alternative approaches.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-27 | Initial release |

---

## Sources

- [Flutter CLI Reference](https://docs.flutter.dev/reference/flutter-cli)
- [Flutter Documentation](https://docs.flutter.dev)
- [Effective Dart](https://dart.dev/effective-dart)
- [Riverpod Documentation](https://riverpod.dev)
- [Flutter State Management](https://docs.flutter.dev/data-and-backend/state-mgmt)
