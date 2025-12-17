# Blazor Framework - Pattern Extraction

**Source**: `agents/yaml/dotnet-blazor-expert.yaml` (v1.0.1)
**Extraction Date**: 2025-10-23
**Purpose**: Extract expertise areas from original agent for skills-based architecture

---

## Agent Mission Analysis

**Original Mission**:
> Implement production-grade .NET Blazor frontend applications using Blazor Server (SignalR-based) or Blazor WebAssembly (client-side SPA), with Fluent UI components, comprehensive state management, and WCAG 2.1 AA accessibility compliance. Specializes in component architecture, forms and validation, routing, and JavaScript interop.

### Core Expertise Areas Identified

1. **Blazor Hosting Models** - Server and WebAssembly
2. **Component Architecture** - Razor components, lifecycle, parameters
3. **Fluent UI Components** - Microsoft Fluent UI Blazor library
4. **State Management** - Component state, services, cascading values
5. **Forms & Validation** - EditForm, validators, error handling
6. **Routing** - @page directive, route parameters, navigation
7. **JavaScript Interop** - JS interop for browser APIs
8. **Accessibility** - WCAG 2.1 AA compliance
9. **SignalR Integration** - Real-time communication (Blazor Server)
10. **Testing** - bUnit component testing

---

## Expertise Area 1: Blazor Hosting Models

### Patterns Identified

**Blazor Server**:
- SignalR-based real-time connection
- Server-side rendering with client updates via SignalR
- Stateful server connection required
- Small initial download, fast startup
- Best for internal apps, intranet scenarios

**Blazor WebAssembly**:
- Client-side execution in browser via WebAssembly
- Full .NET runtime in browser
- Larger initial download, but offline capable
- No server connection after initial load
- Best for public-facing apps, PWAs

**Rendering Modes** (.NET 8+):
- Server: Traditional Blazor Server
- WebAssembly: Client-side execution
- InteractiveAuto: Automatic server/client switching
- Static: Server-side rendering without interactivity

### Code Patterns

```csharp
// Program.cs - Blazor Server setup
builder.Services.AddServerSideBlazor();
app.MapBlazorHub();

// Program.cs - Blazor WebAssembly setup
builder.Services.AddBlazorWebAssembly();

// Component with render mode (.NET 8+)
@rendermode InteractiveServer
@rendermode InteractiveWebAssembly
@rendermode InteractiveAuto
```

---

## Expertise Area 2: Component Architecture

### Patterns Identified

**Razor Component Basics**:
- `.razor` file extension
- Markup (HTML + Razor syntax) in top section
- `@code` block for C# logic
- Component parameters with `[Parameter]`
- Cascading parameters with `[CascadingParameter]`

**Component Lifecycle**:
- `OnInitialized` / `OnInitializedAsync` - Component initialization
- `OnParametersSet` / `OnParametersSetAsync` - After parameters set
- `OnAfterRender` / `OnAfterRenderAsync` - After rendering
- `ShouldRender` - Control rendering
- `Dispose` / `DisposeAsync` - Cleanup (IDisposable)

**Component Communication**:
- Parent to child: Parameters
- Child to parent: EventCallback
- Sibling: Shared service or cascading values
- Global: State management service

### Code Patterns

```razor
<!-- Basic Component -->
@page "/example"

<h3>@Title</h3>
<p>Count: @count</p>
<button @onclick="Increment">Increment</button>

@code {
    [Parameter]
    public string Title { get; set; } = "Default";

    [Parameter]
    public EventCallback<int> OnCountChanged { get; set; }

    private int count = 0;

    protected override async Task OnInitializedAsync()
    {
        // Initialization logic
    }

    private async Task Increment()
    {
        count++;
        await OnCountChanged.InvokeAsync(count);
    }
}
```

---

## Expertise Area 3: Fluent UI Components

### Patterns Identified

**Microsoft Fluent UI Blazor** is the recommended component library:

**Layout Components**:
- `FluentStack` - Flex layout (vertical/horizontal)
- `FluentGrid` - CSS Grid layout
- `FluentSpacer` - Spacing utilities

**Navigation**:
- `FluentNavMenu` - Navigation menu
- `FluentNavLink` - Navigation link
- `FluentTabs` - Tabbed interface

**Data Display**:
- `FluentDataGrid` - Data table with sorting, filtering, pagination
- `FluentCard` - Card container
- `FluentAccordion` - Collapsible panels
- `FluentLabel` - Text label with typography

**Input Components**:
- `FluentTextField` - Text input
- `FluentTextArea` - Multi-line text
- `FluentNumberField` - Numeric input
- `FluentSelect` - Dropdown select
- `FluentCheckbox` - Checkbox
- `FluentSwitch` - Toggle switch
- `FluentDatePicker` - Date picker

**Buttons**:
- `FluentButton` - Primary button
- `FluentIconButton` - Icon-only button
- `FluentSplitButton` - Button with dropdown

**Feedback**:
- `FluentDialog` - Modal dialog
- `FluentMessageBar` - Notification banner
- `FluentProgressRing` - Loading spinner
- `FluentToast` - Toast notification

### Code Patterns

```razor
@using Microsoft.FluentUI.AspNetCore.Components

<FluentStack Orientation="Orientation.Vertical" VerticalGap="16">
    <FluentCard>
        <FluentTextField @bind-Value="name" Label="Name" />
        <FluentButton Appearance="Appearance.Accent" OnClick="Submit">
            Submit
        </FluentButton>
    </FluentCard>

    <FluentDataGrid Items="@items">
        <PropertyColumn Property="@(x => x.Name)" Sortable="true" />
        <PropertyColumn Property="@(x => x.Email)" />
    </FluentDataGrid>
</FluentStack>

@code {
    private string name = "";
    private IQueryable<User> items;
}
```

---

## Expertise Area 4: State Management

### Patterns Identified

**Component State**:
- Private fields in `@code` block
- Binding with `@bind-Value`
- State changes trigger re-render

**Service-Based State**:
- Scoped services for shared state
- Service registration in Program.cs
- Dependency injection in components
- Event-based notifications for state changes

**Cascading Values**:
- Share data down component tree
- `<CascadingValue>` wrapper
- `[CascadingParameter]` in child components

**Local Storage**:
- Persist state to browser localStorage
- JavaScript interop for access
- Blazor.LocalStorage library

**State Management Libraries**:
- Fluxor - Redux-like state management
- Blazor.State - Lightweight state container

### Code Patterns

```csharp
// State service
public class AppState
{
    private string currentUser = "";

    public string CurrentUser
    {
        get => currentUser;
        set
        {
            currentUser = value;
            NotifyStateChanged();
        }
    }

    public event Action? OnChange;

    private void NotifyStateChanged() => OnChange?.Invoke();
}

// Registration
builder.Services.AddScoped<AppState>();

// Component usage
@inject AppState AppState
@implements IDisposable

@code {
    protected override void OnInitialized()
    {
        AppState.OnChange += StateHasChanged;
    }

    public void Dispose()
    {
        AppState.OnChange -= StateHasChanged;
    }
}
```

---

## Expertise Area 5: Forms & Validation

### Patterns Identified

**EditForm Component**:
- `<EditForm Model="@model">` wrapper
- `<DataAnnotationsValidator />` for validation
- `<ValidationSummary />` for error display
- `<ValidationMessage For="@(() => model.Property)" />`

**Validation Approaches**:
- Data Annotations (attributes)
- FluentValidation (custom validators)
- Custom validation logic

**Form Events**:
- `OnValidSubmit` - Form submitted with valid data
- `OnInvalidSubmit` - Form submitted with invalid data
- `OnSubmit` - Form submitted (always)

### Code Patterns

```razor
<EditForm Model="@person" OnValidSubmit="HandleSubmit">
    <DataAnnotationsValidator />
    <ValidationSummary />

    <FluentTextField @bind-Value="person.Name" Label="Name" />
    <ValidationMessage For="@(() => person.Name)" />

    <FluentNumberField @bind-Value="person.Age" Label="Age" />
    <ValidationMessage For="@(() => person.Age)" />

    <FluentButton Type="ButtonType.Submit">Submit</FluentButton>
</EditForm>

@code {
    private Person person = new();

    private async Task HandleSubmit()
    {
        // Form is valid, process data
        await PersonService.SaveAsync(person);
    }

    public class Person
    {
        [Required, MaxLength(100)]
        public string Name { get; set; } = "";

        [Range(0, 150)]
        public int Age { get; set; }
    }
}
```

---

## Expertise Area 6: Routing

### Patterns Identified

**Route Declaration**:
- `@page "/path"` directive
- Multiple routes per component
- Route parameters: `@page "/user/{id}"`
- Optional parameters: `@page "/user/{id?}"`
- Route constraints: `@page "/user/{id:int}"`

**Navigation**:
- `NavigationManager.NavigateTo(url)`
- `<NavLink>` component
- Query strings: `NavigationManager.ToAbsoluteUri(uri).Query`

**Layouts**:
- `@layout LayoutComponent`
- Default layout in `App.razor`
- `@Body` placeholder in layout

### Code Patterns

```razor
@page "/user/{UserId:int}"
@inject NavigationManager Navigation

<h3>User Details: @UserId</h3>
<button @onclick="GoBack">Back</button>

@code {
    [Parameter]
    public int UserId { get; set; }

    private void GoBack()
    {
        Navigation.NavigateTo("/users");
    }
}
```

---

## Expertise Area 7: JavaScript Interop

### Patterns Identified

**Calling JavaScript from Blazor**:
- `IJSRuntime` injection
- `InvokeVoidAsync` - No return value
- `InvokeAsync<T>` - With return value
- JavaScript files in `wwwroot/`

**Calling Blazor from JavaScript**:
- `DotNetObjectReference` for instance methods
- `[JSInvokable]` attribute
- Static methods: `DotNet.invokeMethodAsync`
- Instance methods: `dotNetHelper.invokeMethodAsync`

**Common Use Cases**:
- Browser APIs (localStorage, geolocation)
- Third-party JavaScript libraries
- DOM manipulation not possible in Blazor

### Code Patterns

```csharp
// Component
@inject IJSRuntime JS

@code {
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            // Call JavaScript function
            await JS.InvokeVoidAsync("myJsFunction", "parameter");

            // Get return value
            var result = await JS.InvokeAsync<string>("getLocalStorage", "key");
        }
    }

    [JSInvokable]
    public void CallableFromJS()
    {
        // Can be called from JavaScript
    }
}
```

```javascript
// wwwroot/js/interop.js
window.myJsFunction = (param) => {
    console.log(param);
};

window.getLocalStorage = (key) => {
    return localStorage.getItem(key);
};
```

---

## Expertise Area 8: Accessibility (WCAG 2.1 AA)

### Patterns Identified

**Semantic HTML**:
- Use proper HTML5 elements
- Avoid `<div>` soup
- `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`

**ARIA Attributes**:
- `aria-label`, `aria-labelledby`
- `aria-describedby`
- `aria-hidden`
- `role` attribute

**Keyboard Navigation**:
- All interactive elements focusable
- Tab order logical
- Enter/Space for activation
- Escape to close modals

**Fluent UI Accessibility**:
- Built-in WCAG 2.1 AA compliance
- Proper focus management
- Screen reader support

### Code Patterns

```razor
<!-- Semantic and accessible -->
<nav aria-label="Main navigation">
    <FluentNavMenu>
        <FluentNavLink Href="/" Match="NavLinkMatch.All">Home</FluentNavLink>
        <FluentNavLink Href="/products">Products</FluentNavLink>
    </FluentNavMenu>
</nav>

<main>
    <h1>Page Title</h1>
    <!-- Content -->
</main>

<!-- Button with accessible label -->
<FluentIconButton
    Icon="@(new Icons.Regular.Size20.Delete())"
    aria-label="Delete item"
    OnClick="DeleteItem" />

<!-- Form with labels -->
<FluentTextField
    @bind-Value="email"
    Label="Email address"
    Required="true"
    aria-describedby="email-help" />
<span id="email-help">We'll never share your email.</span>
```

---

## Expertise Area 9: SignalR Integration (Blazor Server)

### Patterns Identified

**Blazor Server Architecture**:
- SignalR connection between browser and server
- Component state maintained on server
- UI updates sent via SignalR
- Connection required for all interactions

**Real-Time Communication**:
- SignalR hubs for bidirectional communication
- Client can call hub methods
- Server can push updates to clients
- Useful for real-time dashboards, chat, notifications

**Connection Management**:
- Reconnection logic built-in
- Circuit lifetime management
- Memory considerations for concurrent users

### Code Patterns

```csharp
// Hub
public class NotificationHub : Hub
{
    public async Task SendNotification(string message)
    {
        await Clients.All.SendAsync("ReceiveNotification", message);
    }
}

// Program.cs
builder.Services.AddServerSideBlazor();
builder.Services.AddSignalR();
app.MapHub<NotificationHub>("/notificationhub");

// Component
@inject NavigationManager Navigation
@implements IAsyncDisposable

@code {
    private HubConnection? hubConnection;

    protected override async Task OnInitializedAsync()
    {
        hubConnection = new HubConnectionBuilder()
            .WithUrl(Navigation.ToAbsoluteUri("/notificationhub"))
            .Build();

        hubConnection.On<string>("ReceiveNotification", (message) =>
        {
            // Handle notification
            StateHasChanged();
        });

        await hubConnection.StartAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (hubConnection is not null)
        {
            await hubConnection.DisposeAsync();
        }
    }
}
```

---

## Expertise Area 10: Testing with bUnit

### Patterns Identified

**bUnit Framework**:
- Unit testing for Blazor components
- Render components in test context
- Interact with rendered components
- Assert on markup and component state

**Test Structure**:
- Arrange: Create component, set parameters
- Act: Interact with component (click, input)
- Assert: Verify markup, state, events

**Common Assertions**:
- Markup assertions (element exists, text content)
- Component state assertions
- Event callback verification
- Parameter change verification

### Code Patterns

```csharp
using Bunit;
using FluentAssertions;
using Xunit;

public class CounterTests : TestContext
{
    [Fact]
    public void Counter_Increments_OnButtonClick()
    {
        // Arrange
        var cut = RenderComponent<Counter>();
        var button = cut.Find("button");

        // Act
        button.Click();

        // Assert
        cut.Find("p").TextContent.Should().Contain("count: 1");
    }

    [Fact]
    public void Counter_Calls_Callback_OnIncrement()
    {
        // Arrange
        var callbackInvoked = false;
        var cut = RenderComponent<Counter>(parameters => parameters
            .Add(p => p.OnCountChanged, () => callbackInvoked = true));

        // Act
        cut.Find("button").Click();

        // Assert
        callbackInvoked.Should().BeTrue();
    }
}
```

---

## Summary: Expertise Areas Mapped

| Area | Description | Coverage in Skill |
|------|-------------|-------------------|
| 1. Hosting Models | Blazor Server vs WebAssembly | SKILL.md Section 1, REFERENCE.md Section 1 |
| 2. Component Architecture | Components, lifecycle, parameters | SKILL.md Section 2, REFERENCE.md Section 2 |
| 3. Fluent UI | Component library usage | SKILL.md Section 3, REFERENCE.md Section 3 |
| 4. State Management | Services, cascading values | SKILL.md Section 4, REFERENCE.md Section 4 |
| 5. Forms & Validation | EditForm, validators | SKILL.md Section 5, REFERENCE.md Section 5 |
| 6. Routing | @page, navigation | SKILL.md Section 6, REFERENCE.md Section 6 |
| 7. JavaScript Interop | JS interop patterns | SKILL.md Section 7, REFERENCE.md Section 7 |
| 8. Accessibility | WCAG 2.1 AA compliance | SKILL.md Section 8, REFERENCE.md Section 8 |
| 9. SignalR | Real-time communication | SKILL.md Section 9, REFERENCE.md Section 9 |
| 10. Testing | bUnit component tests | SKILL.md Section 10, REFERENCE.md Section 10 |

---

## Next Steps

1. ✅ Pattern extraction complete (this document)
2. ⏳ Create SKILL.md with 10 sections (~18KB quick reference)
3. ⏳ Create REFERENCE.md with 10 sections (~40KB comprehensive guide)
4. ⏳ Create templates (6 templates for code generation)
5. ⏳ Create examples (2 real-world examples)
6. ⏳ Feature parity validation (VALIDATION.md with ≥95% target)