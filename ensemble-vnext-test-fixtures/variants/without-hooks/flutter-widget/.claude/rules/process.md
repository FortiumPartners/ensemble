# Development Process - Counter Widget

**Generated:** 2026-01-14

## Workflow

### Feature Development

1. **PRD Creation** (`/create-prd`)
   - Define user stories and acceptance criteria
   - Identify success metrics

2. **TRD Creation** (`/create-trd`)
   - Technical architecture and design
   - Task breakdown with dependencies
   - Risk assessment

3. **Implementation** (`/implement-trd`)
   - Follow TDD: write test first, then implementation
   - Complete each task before moving to next
   - Verify against acceptance criteria

4. **Review & Refinement**
   - Code review for quality
   - Performance testing
   - Documentation updates

## Quality Checklist

Before marking a task complete:
- [ ] Tests written and passing
- [ ] Code formatted (`dart format .`)
- [ ] No analyzer warnings (`flutter analyze`)
- [ ] Documentation updated
- [ ] Widget renders correctly

## Coverage Targets

| Type | Target |
|------|--------|
| Unit Tests | 80% |
| Widget Tests | 70% |

## Commands Reference

| Command | Purpose |
|---------|---------|
| `flutter test` | Run all tests |
| `flutter test --coverage` | Run tests with coverage |
| `flutter analyze` | Static analysis |
| `dart format .` | Format all Dart files |
