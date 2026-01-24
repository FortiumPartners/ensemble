# Flutter Counter Widget

## Overview
Build a Flutter counter widget with dynamic color changes based on the counter value.

## Requirements

### Core Functionality
- Display the current counter value
- Increment button (+) to increase the counter
- Decrement button (-) to decrease the counter
- Color changes based on value:
  - Green when positive (> 0)
  - Red when negative (< 0)
  - Grey when zero (= 0)

### Technical Requirements
- Use proper Flutter widget composition
- StatefulWidget or appropriate state management
- Comprehensive widget tests using flutter_test
- Clean separation of concerns

## Example Usage

```dart
// Widget displays "0" in grey
// User taps + button
// Widget displays "1" in green
// User taps - button twice
// Widget displays "-1" in red
```

## File Structure

```
lib/
  counter_widget.dart  # Main widget implementation
test/
  counter_widget_test.dart  # Widget tests
```

## Success Criteria
- Counter increments and decrements correctly
- Color changes work as specified
- Widget tests pass with good coverage
- Code follows Effective Dart guidelines
