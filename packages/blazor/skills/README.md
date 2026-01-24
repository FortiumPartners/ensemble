# Blazor Framework Skill

**Framework**: Blazor (.NET 8+) with Fluent UI Components
**Target Agent**: `frontend-developer` (generic agent)
**Lazy Loading**: Framework-specific expertise loaded on-demand
**Skill Size**: SKILL.md (~18KB quick reference) + REFERENCE.md (~40KB comprehensive guide)

---

## Overview

This skill provides comprehensive Blazor frontend expertise for the `frontend-developer` agent, enabling it to build production-ready web applications with modern Blazor patterns, including Blazor Server, Blazor WebAssembly, Fluent UI components, and real-time interactivity with SignalR.

### What This Skill Covers

- **Blazor Server & WebAssembly**: Hosting models, rendering modes, prerendering
- **Component Architecture**: Razor components, component lifecycle, parameters, cascading values
- **Fluent UI Components**: Microsoft Fluent UI Blazor component library
- **State Management**: Component state, services, cascading parameters, local storage
- **Forms & Validation**: EditForm, data annotations, FluentValidation
- **JavaScript Interop**: JS interop for browser APIs and third-party libraries
- **Authentication & Authorization**: Identity, JWT, role-based access control
- **Testing**: bUnit for component testing, integration tests

---

## Architecture

```
skills/blazor-framework/
├── README.md                    # This file - overview and usage
├── SKILL.md                     # Quick reference guide (~18KB)
├── REFERENCE.md                 # Comprehensive guide (~40KB)
├── PATTERNS-EXTRACTED.md        # Pattern extraction from dotnet-blazor-expert.yaml
├── VALIDATION.md                # Feature parity validation (≥95% target)
├── templates/
│   ├── component.template.razor      # Blazor component template
│   ├── page.template.razor           # Routable page component
│   ├── service.template.cs           # Service/state management
│   ├── form.template.razor           # Form with validation
│   ├── layout.template.razor         # Layout component
│   └── test.template.cs              # bUnit component test
└── examples/
    ├── todo-app.example.razor        # Complete Todo app with Fluent UI
    ├── realtime-dashboard.example.razor  # Real-time dashboard with SignalR
    └── README.md                     # Examples documentation
```

---

## When to Use

The `frontend-developer` agent **automatically loads this skill** when it detects Blazor patterns:

### Detection Signals

**Primary Signals** (confidence: 0.4 each):
- `.csproj` file with `Microsoft.AspNetCore.Components.WebAssembly` or `Microsoft.AspNetCore.Components.Server`
- `.razor` files in the project
- `_Imports.razor` file
- `App.razor` or `Routes.razor` file

**Secondary Signals** (confidence: 0.2 each):
- `wwwroot/` directory with Blazor assets
- `Pages/` or `Components/` directory with .razor files
- NuGet package references (FluentUI, bUnit, etc.)
- `Program.cs` with Blazor services (`AddServerSideBlazor`, `AddBlazorWebAssembly`)

**Minimum Confidence**: 0.8 (framework detected when signals sum to ≥0.8)

---

## Usage Patterns

### Typical Workflow

1. **Framework Detection**: Agent detects Blazor via `.csproj` + `.razor` files
2. **Skill Loading**: SKILL.md loaded for quick reference
3. **Implementation**: Agent uses patterns, templates, examples
4. **Deep Dive**: REFERENCE.md consulted for complex scenarios
5. **Validation**: Feature parity confirmed via VALIDATION.md

### Example Task

**User Request**: "Create a data table component with sorting and filtering using Fluent UI"

**Agent Flow**:
1. Detects Blazor context (`.csproj` with Blazor packages, `.razor` files)
2. Loads Blazor skill (SKILL.md)
3. References Fluent UI component patterns (FluentDataGrid)
4. Uses `component.template.razor` as starting point
5. Consults `examples/` for data table patterns
6. Implements with Blazor conventions and Fluent UI components

---

## Skill Components

### SKILL.md (Quick Reference)

- **Size**: ~18KB (target: <100KB)
- **Purpose**: Fast lookup of common patterns
- **Contents**:
  - Blazor component basics (Razor syntax, directives)
  - Component lifecycle methods
  - Fluent UI component library
  - Forms and validation patterns
  - State management approaches
  - JavaScript interop basics
  - Authentication and authorization

### REFERENCE.md (Comprehensive Guide)

- **Size**: ~40KB (target: <500KB, max 1MB)
- **Purpose**: Deep-dive reference for complex scenarios
- **Contents**:
  - Complete Blazor architecture guide
  - Advanced component patterns (render fragments, templated components)
  - Blazor Server vs WebAssembly comparison
  - Real-time communication with SignalR
  - Performance optimization (virtualization, lazy loading)
  - State management strategies (services, Fluxor, Blazor state)
  - Advanced forms (custom validators, multi-step forms)
  - Production deployment and hosting

### Templates (Code Generation)

6 production-ready templates with placeholder system:

- `{{ComponentName}}` - Component name (e.g., `TodoList`)
- `{{Namespace}}` - Namespace (e.g., `MyApp.Components`)
- `{{PropertyName}}` - Property name (e.g., `Title`)
- `{{propertyName}}` - Camel case (e.g., `title`)
- `{{ServiceName}}` - Service name (e.g., `TodoService`)

**Reduction**: 60-70% boilerplate reduction via template generation

### Examples (Real-World Code)

2 comprehensive examples demonstrating:
- Complete Todo app with Fluent UI components and local storage
- Real-time dashboard with SignalR and live data updates

---

## Feature Parity

**Target**: ≥95% feature parity with `dotnet-blazor-expert.yaml` agent

**Coverage Areas**:
1. **Blazor Fundamentals** - Components, lifecycle, directives, rendering
2. **Fluent UI Components** - DataGrid, Button, TextField, Dialog, Navigation
3. **Forms & Validation** - EditForm, validators, custom validation
4. **State Management** - Component state, services, cascading values
5. **JavaScript Interop** - JS interop for browser APIs
6. **Testing** - bUnit component tests, integration tests

**Validation**: See `VALIDATION.md` for detailed feature parity analysis

---

## Integration with Frontend Developer

### Agent Loading Pattern

```yaml
# frontend-developer.yaml (simplified)
mission: |
  Implement client-side UI across frameworks/stacks.

  Framework Detection:
  - Detect framework signals (.csproj with Blazor, .razor files, _Imports.razor)
  - Load framework skill when confidence ≥0.8
  - Use skill patterns, templates, examples

  Blazor Detection:
  - .csproj with Microsoft.AspNetCore.Components.*
  - .razor files with @page or component markup
  - Load skills/blazor-framework/SKILL.md
```

### Skill Benefits

- **Generic Agent**: `frontend-developer` stays framework-agnostic
- **Modular Expertise**: Blazor knowledge separated and maintainable
- **Lazy Loading**: Skills loaded only when needed
- **Reduced Bloat**: 65% reduction in agent definition size

---

## Testing Standards

### Coverage Targets

- **Components**: ≥80% (bUnit for component logic)
- **Services**: ≥80% (xUnit for service logic)
- **Integration**: ≥70% (End-to-end with Playwright)
- **Overall Coverage**: ≥75% (measured via coverlet)

### Testing Patterns

- **bUnit**: Primary framework for Blazor component testing
- **xUnit**: Unit tests for services and business logic
- **FluentAssertions**: Readable assertion syntax
- **Playwright**: E2E testing for full application workflows

---

## Blazor Hosting Models

### Blazor Server

**Characteristics**:
- Server-side rendering with SignalR connection
- Small download size, fast initial load
- Stateful server connection required
- Lower client-side resource requirements

**Use Cases**:
- Internal applications (intranet)
- Complex business applications
- When SEO is not critical
- Lower-powered client devices

### Blazor WebAssembly

**Characteristics**:
- Client-side execution in browser via WebAssembly
- Larger initial download, but offline capable
- No server connection after initial load
- Full .NET runtime in browser

**Use Cases**:
- Public-facing applications
- Progressive Web Apps (PWAs)
- Offline-first applications
- When server load is a concern

### Blazor Hybrid (Not Covered in This Skill)

Note: Blazor Hybrid (MAUI) is not covered in this skill. Focus is on web-based Blazor Server and WebAssembly.

---

## Related Skills

- **.NET Skill**: Backend development with ASP.NET Core and Wolverine
- **PostgreSQL Skill**: Database optimization for Blazor applications
- **Testing Skill**: Advanced testing patterns and strategies

---

## Maintenance

### Skill Updates

- **Pattern Extraction**: From production Blazor code reviews
- **Template Refinement**: Based on usage analytics
- **Example Updates**: As Blazor evolves (.NET 8, 9+)
- **Validation**: Continuous feature parity tracking

### Version Compatibility

- **.NET**: 8.0+ (with C# 12)
- **Blazor**: Server and WebAssembly (latest stable)
- **Fluent UI**: Microsoft.FluentUI.AspNetCore.Components (latest)
- **bUnit**: Latest stable for component testing

---

## Fluent UI Component Library

This skill emphasizes the **Microsoft Fluent UI Blazor** component library as the recommended UI framework:

### Key Components Covered

- **Layout**: FluentLayout, FluentStack, FluentGrid
- **Navigation**: FluentNavMenu, FluentNavLink, FluentTabs
- **Data Display**: FluentDataGrid, FluentCard, FluentAccordion
- **Input**: FluentTextField, FluentTextArea, FluentNumberField, FluentSelect
- **Buttons**: FluentButton, FluentIconButton, FluentSplitButton
- **Feedback**: FluentDialog, FluentMessageBar, FluentProgressRing
- **Forms**: Integrated with EditForm and validation

### Why Fluent UI?

- **Official Microsoft Support**: Maintained by Microsoft
- **Modern Design**: Fluent Design System aesthetics
- **Accessibility**: WCAG 2.1 AA compliance built-in
- **Performance**: Optimized for Blazor rendering
- **Comprehensive**: 50+ production-ready components

---

## Quick Start Example

### Basic Blazor Component with Fluent UI

```razor
@page "/counter"
@using Microsoft.FluentUI.AspNetCore.Components

<PageTitle>Counter</PageTitle>

<FluentStack Orientation="Orientation.Vertical" VerticalGap="16">
    <h1>Counter</h1>

    <FluentCard>
        <FluentLabel Typo="Typography.Body">Current count: @currentCount</FluentLabel>
        <FluentButton Appearance="Appearance.Accent" OnClick="IncrementCount">
            Click me
        </FluentButton>
    </FluentCard>
</FluentStack>

@code {
    private int currentCount = 0;

    private void IncrementCount()
    {
        currentCount++;
    }
}
```

---

## References

- **Original Agent**: `agents/yaml/dotnet-blazor-expert.yaml`
- **TRD**: `docs/TRD/skills-based-framework-agents-trd.md` (TRD-043 to TRD-046)
- **Architecture**: Skills-based framework architecture (Sprint 3)

---

**Status**: 🚧 **In Progress** - Sprint 3 (TRD-043)

**Progress**:
1. ✅ TRD-043: Create directory structure
2. ⏳ TRD-044: Extract patterns from dotnet-blazor-expert.yaml
3. ⏳ TRD-045: Create templates (6 templates planned)
4. ⏳ TRD-046: Create examples and validation (2 examples planned)
