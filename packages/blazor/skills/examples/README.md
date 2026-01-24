# Blazor Framework Examples

This directory contains comprehensive real-world examples demonstrating Blazor patterns, Fluent UI components, state management, and SignalR integration.

## Examples Overview

### 1. **todo-app.example.razor** - Complete Todo Application
**Lines**: ~400 | **Complexity**: Intermediate

A production-ready Todo application demonstrating:
- Fluent UI component integration (DataGrid, TextField, Checkbox, Button)
- Local state management with browser localStorage
- CRUD operations (Create, Read, Update, Delete)
- Data persistence across sessions
- Filtering and search functionality
- Component architecture best practices
- Accessibility (WCAG 2.1 AA)

**Technologies**:
- Blazor Server or WebAssembly
- Microsoft Fluent UI Blazor Components
- Blazored.LocalStorage for persistence
- Component-based architecture

**Use Cases**:
- Learning Blazor component patterns
- Understanding state management
- Browser storage integration
- Fluent UI component usage

---

### 2. **realtime-dashboard.example.razor** - Real-Time Dashboard
**Lines**: ~400 | **Complexity**: Advanced

A complete real-time dashboard with SignalR demonstrating:
- SignalR hub integration for live updates
- Real-time data streaming from server to client
- Chart visualization with live data
- Connection state management
- Automatic reconnection handling
- Multiple concurrent data streams
- Blazor Server hosting model

**Technologies**:
- Blazor Server (required for SignalR)
- SignalR for real-time communication
- Microsoft Fluent UI Blazor Components
- Chart visualization
- Background data generation

**Use Cases**:
- Real-time monitoring dashboards
- Live data visualization
- Collaborative applications
- IoT data displays
- Stock tickers / sports scores

---

## Running the Examples

### Prerequisites

```bash
# Install .NET 8.0 SDK or later
dotnet --version  # Should be 8.0 or higher

# Install Node.js (for SignalR client in WebAssembly mode)
node --version  # Should be 18.0 or higher
```

### Setup

1. **Create a new Blazor project**:

```bash
# For Blazor Server (recommended for SignalR example)
dotnet new blazorserver -n BlazorExamples
cd BlazorExamples

# OR for Blazor WebAssembly (for Todo app)
dotnet new blazorwasm -n BlazorExamples
cd BlazorExamples
```

2. **Install required packages**:

```bash
# Fluent UI Components (both examples)
dotnet add package Microsoft.FluentUI.AspNetCore.Components

# For Todo app - Local storage
dotnet add package Blazored.LocalStorage

# For SignalR dashboard (Blazor Server only)
# SignalR is included in Blazor Server by default
```

3. **Configure services in Program.cs**:

```csharp
// For Fluent UI (both examples)
builder.Services.AddFluentUIComponents();

// For Todo app - Local storage
builder.Services.AddBlazoredLocalStorage();

// For SignalR dashboard (Blazor Server)
builder.Services.AddSignalR();

// Add after app.Build()
app.MapHub<DataHub>("/datahub");
```

---

## Example 1: Todo Application

### Quick Start

1. Copy `todo-app.example.razor` to `Pages/Todos.razor`
2. Add to navigation in `NavMenu.razor`:

```razor
<FluentNavLink Href="/todos" Icon="@(new Icons.Regular.Size20.TaskListSquare())">
    Todos
</FluentNavLink>
```

3. Run the application:

```bash
dotnet run
```

4. Navigate to `/todos`

### Features Demonstrated

**Component Architecture**:
- Page component with routing (`@page "/todos"`)
- Local state management
- Event handling
- Conditional rendering

**Fluent UI Components**:
- `FluentTextField` - Text input with validation
- `FluentCheckbox` - Todo completion toggle
- `FluentButton` - Action buttons with icons
- `FluentDataGrid` - Data table with sorting
- `FluentCard` - Content containers
- `FluentStack` - Layout management

**Data Persistence**:
- Browser localStorage integration
- Automatic save on changes
- Data loading on initialization
- JSON serialization

**Operations**:
- Add new todos
- Mark as complete/incomplete
- Edit existing todos
- Delete todos
- Filter by status (All, Active, Completed)
- Search by text

### Code Highlights

```razor
@* Component state *@
@code {
    private List<TodoItem> todos = new();
    private string newTodoText = "";

    protected override async Task OnInitializedAsync()
    {
        // Load from localStorage
        todos = await LocalStorage.GetItemAsync<List<TodoItem>>("todos")
                ?? new List<TodoItem>();
    }

    private async Task AddTodo()
    {
        todos.Add(new TodoItem { Text = newTodoText });
        await SaveTodos();
        newTodoText = "";
    }
}
```

---

## Example 2: Real-Time Dashboard

### Quick Start

1. **Create SignalR Hub** (`Hubs/DataHub.cs`):

```csharp
public class DataHub : Hub
{
    public async Task SendUpdate(string message)
    {
        await Clients.All.SendAsync("ReceiveUpdate", message);
    }
}
```

2. **Copy example** to `Pages/Dashboard.razor`

3. **Add background service** for data generation (`Services/DataGeneratorService.cs`):

```csharp
public class DataGeneratorService : BackgroundService
{
    private readonly IHubContext<DataHub> _hubContext;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var data = GenerateRandomData();
            await _hubContext.Clients.All.SendAsync("ReceiveData", data);
            await Task.Delay(2000); // Update every 2 seconds
        }
    }
}
```

4. **Register services** in Program.cs:

```csharp
builder.Services.AddSignalR();
builder.Services.AddHostedService<DataGeneratorService>();

app.MapHub<DataHub>("/datahub");
```

5. Run and navigate to `/dashboard`

### Features Demonstrated

**SignalR Integration**:
- Hub connection setup
- Real-time message handling
- Automatic reconnection
- Connection state display
- Graceful error handling

**Real-Time Updates**:
- Live data streaming
- Chart updates without page refresh
- Multiple data streams
- Timestamp tracking

**Connection Management**:
- Connection status indicator
- Reconnection logic
- Dispose pattern for cleanup
- Connection lifetime management

**Data Visualization**:
- Live updating charts (pseudo-implementation)
- Statistics cards
- Activity feed
- Metric displays

### Code Highlights

```razor
@code {
    private HubConnection? hubConnection;

    protected override async Task OnInitializedAsync()
    {
        hubConnection = new HubConnectionBuilder()
            .WithUrl(Navigation.ToAbsoluteUri("/datahub"))
            .WithAutomaticReconnect()
            .Build();

        hubConnection.On<DataPoint>("ReceiveData", (data) =>
        {
            // Update UI with new data
            dataPoints.Add(data);
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

## Testing the Examples

### Manual Testing

**Todo App Testing Checklist**:
- [ ] Add a new todo
- [ ] Mark todo as complete
- [ ] Edit existing todo
- [ ] Delete todo
- [ ] Filter by status (All, Active, Completed)
- [ ] Search for specific todo
- [ ] Refresh page (data should persist)
- [ ] Test with 50+ todos (performance)

**Dashboard Testing Checklist**:
- [ ] Verify connection establishes
- [ ] See live data updates
- [ ] Check reconnection after network drop
- [ ] Verify multiple tabs receive updates
- [ ] Test with slow network
- [ ] Monitor memory usage over time
- [ ] Verify cleanup on navigation away

### Automated Testing (bUnit)

```csharp
public class TodoAppTests : TestContext
{
    [Fact]
    public async Task AddTodo_Adds_TodoToList()
    {
        // Arrange
        var mockStorage = new Mock<ILocalStorageService>();
        Services.AddSingleton(mockStorage.Object);

        var cut = RenderComponent<Todos>();

        // Act
        var input = cut.Find("input[type='text']");
        input.Change("New Todo");

        var button = cut.Find("button");
        await button.ClickAsync(new MouseEventArgs());

        // Assert
        cut.FindAll("li").Count.Should().Be(1);
    }
}
```

---

## Best Practices Demonstrated

### Component Design

1. **Single Responsibility**: Each component has a clear purpose
2. **State Management**: Appropriate state scope (component vs service)
3. **Lifecycle Usage**: Proper initialization and cleanup
4. **Event Handling**: Clean event callback patterns

### Performance

1. **Virtualization**: DataGrid virtualization for large lists
2. **Debouncing**: Search input debouncing
3. **ShouldRender**: Optimization where appropriate
4. **Lazy Loading**: Load data only when needed

### Accessibility

1. **Semantic HTML**: Proper element usage
2. **ARIA Labels**: Icon buttons have labels
3. **Keyboard Navigation**: All controls keyboard accessible
4. **Focus Management**: Logical tab order

### Error Handling

1. **Try-Catch Blocks**: Around async operations
2. **User Feedback**: Error messages displayed
3. **Logging**: Comprehensive logging
4. **Graceful Degradation**: Fallbacks for failures

---

## Common Patterns

### Pattern 1: Data Loading

```razor
@code {
    private bool isLoading = true;
    private string? errorMessage;
    private List<Item> items = new();

    protected override async Task OnInitializedAsync()
    {
        try
        {
            items = await LoadDataAsync();
        }
        catch (Exception ex)
        {
            errorMessage = "Failed to load data";
        }
        finally
        {
            isLoading = false;
        }
    }
}
```

### Pattern 2: Form Submission

```razor
<EditForm Model="@model" OnValidSubmit="HandleSubmit">
    <DataAnnotationsValidator />
    <ValidationSummary />

    @* Form fields *@

    <FluentButton Type="ButtonType.Submit" Disabled="@isSubmitting">
        @(isSubmitting ? "Saving..." : "Save")
    </FluentButton>
</EditForm>
```

### Pattern 3: SignalR Setup

```csharp
private HubConnection? hubConnection;

protected override async Task OnInitializedAsync()
{
    hubConnection = new HubConnectionBuilder()
        .WithUrl(Navigation.ToAbsoluteUri("/hub"))
        .WithAutomaticReconnect()
        .Build();

    hubConnection.On<Data>("ReceiveData", HandleData);

    await hubConnection.StartAsync();
}

public async ValueTask DisposeAsync()
{
    if (hubConnection is not null)
    {
        await hubConnection.DisposeAsync();
    }
}
```

---

## Troubleshooting

### Todo App Issues

**Problem**: Todos not persisting
**Solution**: Ensure `Blazored.LocalStorage` is installed and registered

**Problem**: DataGrid not rendering
**Solution**: Verify `Items` property is IQueryable<T>

### Dashboard Issues

**Problem**: SignalR connection fails
**Solution**: Ensure hub is mapped in Program.cs and running Blazor Server

**Problem**: Connection drops frequently
**Solution**: Check network stability, increase timeouts:

```csharp
builder.Services.AddSignalR(options =>
{
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
});
```

**Problem**: Memory leak with long-running connection
**Solution**: Ensure proper disposal in `DisposeAsync`

---

## Additional Resources

- **Blazor Documentation**: https://learn.microsoft.com/en-us/aspnet/core/blazor/
- **Fluent UI Blazor**: https://www.fluentui-blazor.net/
- **SignalR Documentation**: https://learn.microsoft.com/en-us/aspnet/core/signalr/
- **bUnit Testing**: https://bunit.dev/

---

## Related Skills

- `skills/blazor-framework/SKILL.md` - Quick reference
- `skills/blazor-framework/REFERENCE.md` - Comprehensive guide
- `skills/blazor-framework/templates/` - Code generation templates
- `skills/dotnet-framework/` - Backend .NET patterns

---

**Next Steps**: See `VALIDATION.md` for feature parity analysis with `dotnet-blazor-expert.yaml` agent.
