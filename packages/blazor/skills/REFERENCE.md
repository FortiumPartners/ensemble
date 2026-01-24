# Blazor Framework - Comprehensive Reference (REFERENCE.md)

**Version**: 1.0.0
**Target**: .NET 8.0+ with Blazor Server/WebAssembly
**UI Library**: Microsoft Fluent UI Blazor Components
**Purpose**: Deep-dive guide for advanced scenarios and production deployment

---

## Table of Contents

1. [Blazor Architecture & Hosting](#1-blazor-architecture--hosting)
2. [Advanced Component Patterns](#2-advanced-component-patterns)
3. [Fluent UI Advanced Usage](#3-fluent-ui-advanced-usage)
4. [State Management Strategies](#4-state-management-strategies)
5. [Advanced Forms & Validation](#5-advanced-forms--validation)
6. [Routing & Navigation Advanced](#6-routing--navigation-advanced)
7. [JavaScript Interop Deep Dive](#7-javascript-interop-deep-dive)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Performance Optimization](#9-performance-optimization)
10. [Production Deployment](#10-production-deployment)

---

## 1. Blazor Architecture & Hosting

### Blazor Server Architecture

**Component Lifecycle**:
```
Browser (UI) <--SignalR--> ASP.NET Core Server (Components)
                              |
                              v
                         State (in memory)
```

**Characteristics**:
- Components execute on server
- UI events sent to server via SignalR
- Server sends UI updates back to browser
- Stateful connection maintained per user

**Advantages**:
- Small initial download (~2MB)
- Fast initial load time
- Full .NET API access on server
- Secure (code never exposed to client)
- Lower client device requirements

**Disadvantages**:
- Requires persistent connection
- Latency for every UI interaction
- Server memory usage per connected user
- No offline support
- Server CPU usage scales with users

**Configuration**:
```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor(options =>
{
    // Configure SignalR circuit options
    options.DetailedErrors = builder.Environment.IsDevelopment();
    options.DisconnectedCircuitMaxRetained = 100;
    options.DisconnectedCircuitRetentionPeriod = TimeSpan.FromMinutes(3);
    options.JSInteropDefaultCallTimeout = TimeSpan.FromMinutes(1);
    options.MaxBufferedUnacknowledgedRenderBatches = 10;
});

// Add SignalR configuration
builder.Services.AddSignalR(options =>
{
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
    options.HandshakeTimeout = TimeSpan.FromSeconds(15);
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.MaximumReceiveMessageSize = 32 * 1024; // 32KB
});

var app = builder.Build();

app.UseStaticFiles();
app.UseRouting();

app.MapBlazorHub();
app.MapFallbackToPage("/_Host");

app.Run();
```

---

### Blazor WebAssembly Architecture

**Component Lifecycle**:
```
Browser (WebAssembly Runtime + .NET + Components)
   |
   v
Local Storage / IndexedDB / API calls
```

**Characteristics**:
- Components execute in browser via WebAssembly
- Full .NET runtime downloaded to browser
- No server connection needed after initial load
- Stateless from server perspective

**Advantages**:
- Offline capable (with PWA)
- No server load for UI interactions
- Scalable (static hosting)
- Rich client-side experience

**Disadvantages**:
- Large initial download (~10-15MB)
- Slower initial load time
- Limited by browser sandbox
- Code visible to client
- Higher client device requirements

**Configuration**:
```csharp
// Program.cs (Client)
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// Configure services
builder.Services.AddScoped(sp => new HttpClient
{
    BaseAddress = new Uri(builder.HostEnvironment.BaseAddress)
});

// Add authentication
builder.Services.AddOidcAuthentication(options =>
{
    builder.Configuration.Bind("Auth0", options.ProviderOptions);
});

await builder.Build().RunAsync();
```

---

### Blazor Hybrid (Auto Mode - .NET 8+)

**Interactive Render Modes**:

```razor
@* Component-level render mode *@
@rendermode InteractiveServer
@rendermode InteractiveWebAssembly
@rendermode InteractiveAuto

@* Global render mode (App.razor) *@
<HeadOutlet @rendermode="@RenderModeForPage" />
```

**Auto Mode Behavior**:
1. First load: Component renders on server (fast initial load)
2. Background: WebAssembly runtime downloads
3. Subsequent loads: Component renders on client (offline capable)

**Use Case**: Best of both worlds - fast startup + rich client experience

---

## 2. Advanced Component Patterns

### Render Fragments

```razor
@* Component with customizable content *@
<div class="card">
    <div class="card-header">
        @HeaderContent
    </div>
    <div class="card-body">
        @BodyContent
    </div>
    <div class="card-footer">
        @FooterContent
    </div>
</div>

@code {
    [Parameter]
    public RenderFragment? HeaderContent { get; set; }

    [Parameter]
    public RenderFragment? BodyContent { get; set; }

    [Parameter]
    public RenderFragment? FooterContent { get; set; }
}

@* Usage *@
<Card>
    <HeaderContent>
        <h3>Card Title</h3>
    </HeaderContent>
    <BodyContent>
        <p>Card body content goes here.</p>
    </BodyContent>
    <FooterContent>
        <button>Action</button>
    </FooterContent>
</Card>
```

---

### Templated Components

```razor
@* Generic templated component *@
@typeparam TItem

<table>
    <thead>
        <tr>@TableHeader</tr>
    </thead>
    <tbody>
        @foreach (var item in Items)
        {
            <tr>@RowTemplate(item)</tr>
        }
    </tbody>
</table>

@code {
    [Parameter, EditorRequired]
    public RenderFragment? TableHeader { get; set; }

    [Parameter, EditorRequired]
    public RenderFragment<TItem>? RowTemplate { get; set; }

    [Parameter, EditorRequired]
    public IEnumerable<TItem> Items { get; set; } = Enumerable.Empty<TItem>();
}

@* Usage *@
<DataTable TItem="User" Items="@users">
    <TableHeader>
        <th>Name</th>
        <th>Email</th>
        <th>Actions</th>
    </TableHeader>
    <RowTemplate Context="user">
        <td>@user.Name</td>
        <td>@user.Email</td>
        <td><button @onclick="() => Edit(user)">Edit</button></td>
    </RowTemplate>
</DataTable>
```

---

### Component Virtualization

**For large lists** - Only render visible items:

```razor
@using Microsoft.AspNetCore.Components.Web.Virtualization

<Virtualize Items="@allItems" Context="item">
    <ItemContent>
        <div class="item">
            <h4>@item.Title</h4>
            <p>@item.Description</p>
        </div>
    </ItemContent>
    <Placeholder>
        <div class="item-placeholder">Loading...</div>
    </Placeholder>
</Virtualize>

@code {
    private List<Item> allItems = Enumerable.Range(1, 10000)
        .Select(i => new Item { Title = $"Item {i}", Description = $"Description {i}" })
        .ToList();
}
```

**With async data loading**:
```razor
<Virtualize ItemsProvider="LoadItems" Context="item">
    <ItemContent>
        <div>@item.Name</div>
    </ItemContent>
</Virtualize>

@code {
    private async ValueTask<ItemsProviderResult<Item>> LoadItems(
        ItemsProviderRequest request)
    {
        var items = await DataService.GetItemsAsync(
            request.StartIndex,
            request.Count);

        var totalCount = await DataService.GetTotalCountAsync();

        return new ItemsProviderResult<Item>(items, totalCount);
    }
}
```

---

### Error Boundaries

```razor
<ErrorBoundary>
    <ChildContent>
        @* Components that might throw *@
        <ProblemComponent />
    </ChildContent>
    <ErrorContent Context="exception">
        <div class="error-message">
            <h3>Something went wrong</h3>
            <p>@exception.Message</p>
            <button @onclick="Recover">Try Again</button>
        </div>
    </ErrorContent>
</ErrorBoundary>

@code {
    private void Recover()
    {
        // Reset error boundary
        StateHasChanged();
    }
}
```

---

## 3. Fluent UI Advanced Usage

### Custom Themes

```csharp
// Program.cs
builder.Services.AddFluentUIComponents(options =>
{
    options.HostingModel = BlazorHostingModel.Server; // or WebAssembly
});

// Custom theme
public class CustomTheme
{
    public string PrimaryColor => "#0078D4";
    public string BackgroundColor => "#FFFFFF";
    public string FontFamily => "Segoe UI, sans-serif";
}
```

```razor
@* Apply theme *@
<FluentDesignTheme
    @bind-Mode="@themeMode"
    StorageName="theme-preference"
    Style="background-color: var(--neutral-layer-1);">
    <Router AppAssembly="@typeof(Program).Assembly">
        @* App content *@
    </Router>
</FluentDesignTheme>

@code {
    private DesignThemeModes themeMode = DesignThemeModes.Light;
}
```

---

### DataGrid Advanced Features

```razor
<FluentDataGrid Items="@filteredUsers" Pagination="@pagination" Virtualize="true">
    @* Sortable column *@
    <PropertyColumn Property="@(u => u.Name)" Sortable="true" />

    @* Custom format *@
    <PropertyColumn
        Property="@(u => u.CreatedAt)"
        Format="yyyy-MM-dd HH:mm"
        Sortable="true" />

    @* Template column *@
    <TemplateColumn Title="Status">
        <FluentBadge Appearance="@(context.IsActive ? "success" : "neutral")">
            @(context.IsActive ? "Active" : "Inactive")
        </FluentBadge>
    </TemplateColumn>

    @* Actions column *@
    <TemplateColumn Title="Actions">
        <FluentButton Size="ButtonSize.Small" OnClick="@(() => Edit(context))">
            Edit
        </FluentButton>
        <FluentButton
            Size="ButtonSize.Small"
            Appearance="Appearance.Stealth"
            OnClick="@(() => Delete(context))">
            Delete
        </FluentButton>
    </TemplateColumn>
</FluentDataGrid>

<FluentPaginator State="@pagination" />

@code {
    private IQueryable<User> filteredUsers = null!;
    private PaginationState pagination = new() { ItemsPerPage = 20 };

    protected override void OnInitialized()
    {
        filteredUsers = users.AsQueryable();
    }
}
```

---

### Dialog with Complex Content

```razor
<FluentDialog @ref="dialog" Modal="true" TrapFocus="true">
    <FluentDialogHeader>
        <h3>User Details</h3>
        <FluentButton
            Appearance="Appearance.Stealth"
            IconOnly="true"
            OnClick="CloseDialog">
            <FluentIcon Icon="Icons.Regular.Size20.Dismiss" />
        </FluentButton>
    </FluentDialogHeader>

    <FluentDialogBody>
        <EditForm Model="@user" OnValidSubmit="SaveUser">
            <DataAnnotationsValidator />

            <FluentStack Orientation="Orientation.Vertical" VerticalGap="16">
                <FluentTextField @bind-Value="user.Name" Label="Name" Required />
                <FluentTextField @bind-Value="user.Email" Label="Email" Required />
                <FluentNumberField @bind-Value="user.Age" Label="Age" />
            </FluentStack>
        </EditForm>
    </FluentDialogBody>

    <FluentDialogFooter>
        <FluentButton Appearance="Appearance.Accent" OnClick="SaveUser">
            Save
        </FluentButton>
        <FluentButton Appearance="Appearance.Neutral" OnClick="CloseDialog">
            Cancel
        </FluentButton>
    </FluentDialogFooter>
</FluentDialog>

@code {
    private FluentDialog? dialog;
    private User user = new();

    private async Task OpenDialog(User userData)
    {
        user = userData;
        await dialog!.ShowAsync();
    }

    private async Task CloseDialog()
    {
        await dialog!.HideAsync();
    }

    private async Task SaveUser()
    {
        await UserService.SaveAsync(user);
        await CloseDialog();
    }
}
```

---

## 4. State Management Strategies

### Service-Based State (Recommended)

```csharp
// AppState.cs
public class AppState
{
    private User? currentUser;
    private List<Notification> notifications = new();

    public User? CurrentUser
    {
        get => currentUser;
        set
        {
            if (currentUser != value)
            {
                currentUser = value;
                NotifyStateChanged();
            }
        }
    }

    public IReadOnlyList<Notification> Notifications => notifications.AsReadOnly();

    public event Action? OnChange;

    public void AddNotification(Notification notification)
    {
        notifications.Add(notification);
        NotifyStateChanged();
    }

    public void ClearNotifications()
    {
        notifications.Clear();
        NotifyStateChanged();
    }

    private void NotifyStateChanged() => OnChange?.Invoke();
}

// Program.cs
builder.Services.AddScoped<AppState>();

// Component
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

### Fluxor State Management

**Install**: `Fluxor.Blazor.Web`

```csharp
// State
public record CounterState
{
    public int Count { get; init; }
}

// Feature
public class CounterFeature : Feature<CounterState>
{
    public override string GetName() => "Counter";

    protected override CounterState GetInitialState() =>
        new CounterState { Count = 0 };
}

// Actions
public record IncrementCounterAction;
public record DecrementCounterAction;

// Reducer
public static class CounterReducers
{
    [ReducerMethod]
    public static CounterState OnIncrement(CounterState state, IncrementCounterAction action) =>
        state with { Count = state.Count + 1 };

    [ReducerMethod]
    public static CounterState OnDecrement(CounterState state, DecrementCounterAction action) =>
        state with { Count = state.Count - 1 };
}

// Program.cs
builder.Services.AddFluxor(options =>
{
    options.ScanAssemblies(typeof(Program).Assembly);
    options.UseReduxDevTools();
});

// Component
@inherits FluxorComponent
@inject IState<CounterState> CounterState
@inject IDispatcher Dispatcher

<p>Count: @CounterState.Value.Count</p>
<button @onclick="Increment">Increment</button>

@code {
    private void Increment()
    {
        Dispatcher.Dispatch(new IncrementCounterAction());
    }
}
```

---

### Local Storage State Persistence

```csharp
// Install: Blazored.LocalStorage

// Program.cs
builder.Services.AddBlazoredLocalStorage();

// Service
public class PersistentState
{
    private readonly ILocalStorageService localStorage;
    private const string KEY = "app-state";

    public PersistentState(ILocalStorageService localStorage)
    {
        this.localStorage = localStorage;
    }

    public async Task<AppData?> LoadAsync()
    {
        return await localStorage.GetItemAsync<AppData>(KEY);
    }

    public async Task SaveAsync(AppData data)
    {
        await localStorage.SetItemAsync(KEY, data);
    }

    public async Task ClearAsync()
    {
        await localStorage.RemoveItemAsync(KEY);
    }
}

// Component
@inject PersistentState PersistentState

@code {
    protected override async Task OnInitializedAsync()
    {
        var data = await PersistentState.LoadAsync();
        if (data != null)
        {
            // Restore state
        }
    }

    private async Task SaveState()
    {
        await PersistentState.SaveAsync(new AppData { /* current state */ });
    }
}
```

---

## 5. Advanced Forms & Validation

### Multi-Step Form

```razor
<EditForm Model="@model" OnValidSubmit="HandleSubmit">
    <DataAnnotationsValidator />

    @switch (currentStep)
    {
        case 1:
            <Step1 @bind-Model="model" />
            break;
        case 2:
            <Step2 @bind-Model="model" />
            break;
        case 3:
            <Step3 @bind-Model="model" />
            break;
    }

    <FluentStack Orientation="Orientation.Horizontal" HorizontalGap="8">
        @if (currentStep > 1)
        {
            <FluentButton OnClick="PreviousStep">Previous</FluentButton>
        }
        @if (currentStep < 3)
        {
            <FluentButton Appearance="Appearance.Accent" OnClick="NextStep">
                Next
            </FluentButton>
        }
        else
        {
            <FluentButton Type="ButtonType.Submit" Appearance="Appearance.Accent">
                Submit
            </FluentButton>
        }
    </FluentStack>
</EditForm>

@code {
    private RegistrationModel model = new();
    private int currentStep = 1;

    private void NextStep()
    {
        if (ValidateCurrentStep())
        {
            currentStep++;
        }
    }

    private void PreviousStep()
    {
        currentStep--;
    }

    private bool ValidateCurrentStep()
    {
        // Validate only current step fields
        var validationContext = new ValidationContext(model);
        var results = new List<ValidationResult>();
        return Validator.TryValidateObject(model, validationContext, results, validateAllProperties: true);
    }

    private async Task HandleSubmit()
    {
        await SaveRegistrationAsync(model);
    }
}
```

---

### Custom Async Validator

```csharp
public class UniqueEmailAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext validationContext)
    {
        // Note: For async validation, use FluentValidation instead
        if (value is string email)
        {
            var userService = validationContext.GetService<IUserService>();
            var exists = userService!.EmailExistsAsync(email).GetAwaiter().GetResult();

            if (exists)
            {
                return new ValidationResult("Email already exists");
            }
        }

        return ValidationResult.Success;
    }
}

// FluentValidation (better for async)
public class UserValidator : AbstractValidator<User>
{
    private readonly IUserService userService;

    public UserValidator(IUserService userService)
    {
        this.userService = userService;

        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MustAsync(BeUniqueEmail)
            .WithMessage("Email already exists");
    }

    private async Task<bool> BeUniqueEmail(string email, CancellationToken cancellationToken)
    {
        return !await userService.EmailExistsAsync(email);
    }
}
```

---

### Dynamic Form Generation

```razor
@foreach (var field in formDefinition.Fields)
{
    @switch (field.Type)
    {
        case FieldType.Text:
            <FluentTextField @bind-Value="formData[field.Name]" Label="@field.Label" />
            break;

        case FieldType.Number:
            <FluentNumberField
                @bind-Value="@GetNumberValue(field.Name)"
                Label="@field.Label" />
            break;

        case FieldType.Select:
            <FluentSelect
                @bind-Value="formData[field.Name]"
                Label="@field.Label"
                Items="@field.Options" />
            break;

        case FieldType.Checkbox:
            <FluentCheckbox
                @bind-Value="@GetBoolValue(field.Name)"
                Label="@field.Label" />
            break;
    }
}

@code {
    private FormDefinition formDefinition = new();
    private Dictionary<string, object> formData = new();

    private int GetNumberValue(string fieldName)
    {
        return formData.TryGetValue(fieldName, out var value) ? (int)value : 0;
    }

    private bool GetBoolValue(string fieldName)
    {
        return formData.TryGetValue(fieldName, out var value) && (bool)value;
    }
}
```

---

## 6. Routing & Navigation Advanced

### Query String Parameters

```csharp
@inject NavigationManager Navigation
@implements IDisposable

@code {
    private string? searchTerm;
    private int page = 1;

    protected override void OnInitialized()
    {
        Navigation.LocationChanged += OnLocationChanged;
        LoadQueryParameters();
    }

    private void LoadQueryParameters()
    {
        var uri = new Uri(Navigation.Uri);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);

        searchTerm = query["search"];
        if (int.TryParse(query["page"], out var pageNum))
        {
            page = pageNum;
        }
    }

    private void OnLocationChanged(object? sender, LocationChangedEventArgs e)
    {
        LoadQueryParameters();
        StateHasChanged();
    }

    private void UpdateQueryString()
    {
        var query = System.Web.HttpUtility.ParseQueryString(string.Empty);
        if (!string.IsNullOrEmpty(searchTerm))
            query["search"] = searchTerm;
        query["page"] = page.ToString();

        var url = $"{Navigation.BaseUri}products?{query}";
        Navigation.NavigateTo(url);
    }

    public void Dispose()
    {
        Navigation.LocationChanged -= OnLocationChanged;
    }
}
```

---

### Route Constraints

```razor
@* Built-in constraints *@
@page "/user/{id:int}"
@page "/product/{id:guid}"
@page "/blog/{year:int}/{month:int}/{day:int}/{slug}"
@page "/category/{name:length(3,50)}"
@page "/item/{id:minlength(5)}"
@page "/item/{id:maxlength(10)}"
@page "/number/{value:range(1,100)}"
@page "/number/{value:min(1)}"
@page "/number/{value:max(100)}"

@* Custom constraint *@
public class SlugRouteConstraint : IRouteConstraint
{
    public bool Match(
        HttpContext? httpContext,
        IRouter? route,
        string routeKey,
        RouteValueDictionary values,
        RouteDirection routeDirection)
    {
        if (values.TryGetValue(routeKey, out var value) && value is string slug)
        {
            return Regex.IsMatch(slug, @"^[a-z0-9-]+$");
        }
        return false;
    }
}

// Register in Program.cs
builder.Services.Configure<RouteOptions>(options =>
{
    options.ConstraintMap.Add("slug", typeof(SlugRouteConstraint));
});

// Usage
@page "/post/{slug:slug}"
```

---

### Navigation Guards

```csharp
// NavigationGuard.cs
public class NavigationGuard : IDisposable
{
    private readonly NavigationManager navigationManager;
    private bool hasUnsavedChanges;

    public NavigationGuard(NavigationManager navigationManager)
    {
        this.navigationManager = navigationManager;
        navigationManager.LocationChanged += OnLocationChanged;
    }

    public void SetHasUnsavedChanges(bool value)
    {
        hasUnsavedChanges = value;
    }

    private void OnLocationChanged(object? sender, LocationChangedEventArgs e)
    {
        if (hasUnsavedChanges)
        {
            // Optionally prevent navigation or show warning
            // Note: Browser's beforeunload can be used via JS interop
        }
    }

    public void Dispose()
    {
        navigationManager.LocationChanged -= OnLocationChanged;
    }
}

// Component
@inject IJSRuntime JS
@implements IDisposable

@code {
    private bool hasUnsavedChanges;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            await JS.InvokeVoidAsync("registerBeforeUnload");
        }
    }

    private void OnFormChanged()
    {
        hasUnsavedChanges = true;
    }

    public void Dispose()
    {
        JS.InvokeVoidAsync("unregisterBeforeUnload");
    }
}
```

```javascript
// wwwroot/js/navigation-guard.js
let beforeUnloadHandler;

window.registerBeforeUnload = () => {
    beforeUnloadHandler = (e) => {
        e.preventDefault();
        e.returnValue = '';
        return '';
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
};

window.unregisterBeforeUnload = () => {
    if (beforeUnloadHandler) {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
    }
};
```

---

## 7. JavaScript Interop Deep Dive

### Module-Based JS Interop (.NET 6+)

```csharp
@inject IJSRuntime JS
@implements IAsyncDisposable

@code {
    private IJSObjectReference? module;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            // Load JS module
            module = await JS.InvokeAsync<IJSObjectReference>(
                "import", "./js/myModule.js");

            // Call module function
            await module.InvokeVoidAsync("initialize", elementRef);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (module is not null)
        {
            await module.DisposeAsync();
        }
    }
}
```

```javascript
// wwwroot/js/myModule.js
export function initialize(element) {
    console.log("Initializing", element);
}

export function getData() {
    return { value: 42, timestamp: Date.now() };
}
```

---

### ElementReference and DOM Manipulation

```razor
<input @ref="inputElement" />
<button @onclick="FocusInput">Focus Input</button>

@code {
    private ElementReference inputElement;

    private async Task FocusInput()
    {
        await JS.InvokeVoidAsync("focusElement", inputElement);
    }
}
```

```javascript
window.focusElement = (element) => {
    element.focus();
};
```

---

### Bidirectional Communication

```csharp
// Component with callback
public class InteropComponent : ComponentBase, IDisposable
{
    [Inject]
    private IJSRuntime JS { get; set; } = default!;

    private DotNetObjectReference<InteropComponent>? dotNetRef;

    protected override async Task OnInitializedAsync()
    {
        dotNetRef = DotNetObjectReference.Create(this);
        await JS.InvokeVoidAsync("startMonitoring", dotNetRef);
    }

    [JSInvokable]
    public void OnDataReceived(string data)
    {
        Console.WriteLine($"Data received from JS: {data}");
        StateHasChanged();
    }

    [JSInvokable]
    public Task<string> GetCurrentState()
    {
        return Task.FromResult("Current state data");
    }

    public void Dispose()
    {
        JS.InvokeVoidAsync("stopMonitoring");
        dotNetRef?.Dispose();
    }
}
```

```javascript
let dotNetHelper;

window.startMonitoring = (helper) => {
    dotNetHelper = helper;

    // Simulate data updates
    setInterval(async () => {
        await dotNetHelper.invokeMethodAsync('OnDataReceived', 'New data');

        const state = await dotNetHelper.invokeMethodAsync('GetCurrentState');
        console.log('Current state:', state);
    }, 5000);
};

window.stopMonitoring = () => {
    // Cleanup
};
```

---

## 8. Authentication & Authorization

### JWT Authentication (Blazor Server)

```csharp
// Program.cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!))
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
        policy.RequireRole("Admin"));

    options.AddPolicy("MinimumAge", policy =>
        policy.Requirements.Add(new MinimumAgeRequirement(18)));
});

// Custom requirement
public class MinimumAgeRequirement : IAuthorizationRequirement
{
    public int MinimumAge { get; }

    public MinimumAgeRequirement(int minimumAge)
    {
        MinimumAge = minimumAge;
    }
}

public class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        MinimumAgeRequirement requirement)
    {
        var dateOfBirthClaim = context.User.FindFirst(c => c.Type == "DateOfBirth");

        if (dateOfBirthClaim == null)
            return Task.CompletedTask;

        var dateOfBirth = Convert.ToDateTime(dateOfBirthClaim.Value);
        var age = DateTime.Today.Year - dateOfBirth.Year;

        if (age >= requirement.MinimumAge)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
```

---

### Component-Level Authorization

```razor
@attribute [Authorize]
@attribute [Authorize(Roles = "Admin")]
@attribute [Authorize(Policy = "MinimumAge")]

@* Conditional rendering *@
<AuthorizeView>
    <Authorized>
        <p>Welcome, @context.User.Identity?.Name!</p>
        <button @onclick="PerformAction">Restricted Action</button>
    </Authorized>
    <NotAuthorized>
        <p>You are not authorized to view this content.</p>
    </NotAuthorized>
</AuthorizeView>

@* Role-based *@
<AuthorizeView Roles="Admin, Manager">
    <Authorized>
        <AdminPanel />
    </Authorized>
</AuthorizeView>

@* Policy-based *@
<AuthorizeView Policy="MinimumAge">
    <Authorized>
        <AdultContent />
    </Authorized>
    <NotAuthorized>
        <p>You must be 18 or older.</p>
    </NotAuthorized>
</AuthorizeView>
```

---

### OAuth/OIDC (Blazor WebAssembly)

```csharp
// Program.cs
builder.Services.AddOidcAuthentication(options =>
{
    builder.Configuration.Bind("Auth0", options.ProviderOptions);
    options.ProviderOptions.ResponseType = "code";
    options.ProviderOptions.AdditionalProviderParameters.Add("audience", "https://api.example.com");
});

// appsettings.json
{
  "Auth0": {
    "Authority": "https://your-domain.auth0.com",
    "ClientId": "your-client-id",
    "ResponseType": "code"
  }
}

// App.razor
<CascadingAuthenticationState>
    <Router AppAssembly="@typeof(Program).Assembly">
        <Found Context="routeData">
            <AuthorizeRouteView RouteData="@routeData" DefaultLayout="@typeof(MainLayout)">
                <NotAuthorized>
                    <RedirectToLogin />
                </NotAuthorized>
            </AuthorizeRouteView>
        </Found>
    </Router>
</CascadingAuthenticationState>
```

---

## 9. Performance Optimization

### Lazy Loading

```razor
@* Component lazy loading *@
<Router AppAssembly="@typeof(Program).Assembly" AdditionalAssemblies="@lazyLoadedAssemblies">
    @* Routes *@
</Router>

@code {
    private List<Assembly> lazyLoadedAssemblies = new();

    protected override async Task OnInitializedAsync()
    {
        var assemblies = await LazyAssemblyLoader.LoadAssembliesAsync(
            new[] { "MyApp.AdminModule.dll", "MyApp.ReportsModule.dll" });

        lazyLoadedAssemblies.AddRange(assemblies);
    }
}
```

---

### Rendering Optimization

```csharp
// Skip unnecessary renders
protected override bool ShouldRender()
{
    // Only render if data has actually changed
    return dataHasChanged;
}

// Use ImmutableList for collections
private ImmutableList<Item> items = ImmutableList<Item>.Empty;

// Avoid creating new instances in render
@* Bad *@
<Component Data="@(new List<int> { 1, 2, 3 })" />

@* Good *@
<Component Data="@cachedData" />
```

---

### Streaming Rendering (.NET 8+)

```razor
@attribute [StreamRendering(true)]

@if (data == null)
{
    <p>Loading...</p>
}
else
{
    <DataGrid Items="@data" />
}

@code {
    private List<Item>? data;

    protected override async Task OnInitializedAsync()
    {
        // Initial fast render with null data
        await Task.Yield();

        // Load data (streamed update)
        data = await DataService.GetDataAsync();
    }
}
```

---

## 10. Production Deployment

### Blazor Server Deployment

**IIS Configuration**:
```xml
<!-- web.config -->
<configuration>
  <system.webServer>
    <handlers>
      <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
    </handlers>
    <aspNetCore processPath="dotnet"
                arguments=".\MyApp.dll"
                stdoutLogEnabled="false"
                stdoutLogFile=".\logs\stdout"
                hostingModel="InProcess">
      <environmentVariables>
        <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
      </environmentVariables>
    </aspNetCore>
  </system.webServer>
</configuration>
```

**SignalR Configuration for Scale**:
```csharp
// Use Azure SignalR Service for scale-out
builder.Services.AddSignalR()
    .AddAzureSignalR(options =>
    {
        options.ConnectionString = configuration["Azure:SignalR:ConnectionString"];
    });

// Or use Redis backplane
builder.Services.AddSignalR()
    .AddStackExchangeRedis(configuration["Redis:ConnectionString"]);
```

---

### Blazor WebAssembly Deployment

**Static File Hosting** (Azure Static Web Apps, Netlify, GitHub Pages):

```json
// staticwebapp.config.json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/_framework/*", "/css/*", "/js/*"]
  },
  "mimeTypes": {
    ".dll": "application/octet-stream",
    ".wasm": "application/wasm"
  },
  "responseOverrides": {
    "404": {
      "rewrite": "/index.html",
      "statusCode": 200
    }
  }
}
```

**Compression**:
```csharp
// Program.cs (Server for hosted model)
app.UseResponseCompression();

builder.Services.AddResponseCompression(opts =>
{
    opts.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/octet-stream", "application/wasm" });
});
```

---

### PWA Configuration

```json
// wwwroot/manifest.json
{
  "name": "My Blazor App",
  "short_name": "BlazorApp",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0078D4",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

```html
<!-- index.html -->
<link rel="manifest" href="manifest.json" />
<link rel="apple-touch-icon" href="icon-192.png" />
<meta name="theme-color" content="#0078D4" />
```

---

**For more examples and validation, see**:
- `examples/todo-app.example.razor` - Complete Todo app
- `examples/realtime-dashboard.example.razor` - Real-time SignalR dashboard
- `VALIDATION.md` - Feature parity validation
