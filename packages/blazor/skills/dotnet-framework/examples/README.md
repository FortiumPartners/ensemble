# .NET Framework Examples

This directory contains comprehensive real-world examples demonstrating .NET patterns, best practices, and integration with Wolverine message handling and MartenDB document storage.

## Examples Overview

### 1. **web-api.example.cs** - Complete RESTful API
**Lines**: ~550 | **Complexity**: Intermediate

A production-ready RESTful API for a blog platform demonstrating:
- ASP.NET Core Web API with controllers and minimal APIs
- Wolverine command/query handlers
- MartenDB document storage
- JWT authentication and authorization
- Request validation with FluentValidation
- API versioning and documentation
- Error handling and logging

**Technologies**:
- ASP.NET Core 8.0+
- Wolverine for message handling
- MartenDB for document storage
- JWT Bearer authentication
- Swagger/OpenAPI documentation

**Use Cases**:
- Building RESTful APIs with CQRS
- Implementing authentication/authorization
- Document storage with MartenDB
- Message-driven architecture

---

### 2. **event-sourcing.example.cs** - Event Sourcing Implementation
**Lines**: ~550 | **Complexity**: Advanced

A complete event sourcing implementation for order management demonstrating:
- Event-sourced aggregates with MartenDB
- Event streams and projections
- Command handlers producing events
- Read models with inline and async projections
- Optimistic concurrency control
- Event versioning and migration
- Temporal queries and event replay

**Technologies**:
- MartenDB Event Store
- Wolverine command handling
- Event sourcing patterns
- CQRS with projections
- Temporal queries

**Use Cases**:
- Event sourcing architecture
- Audit trails and temporal queries
- CQRS with read models
- Complex domain modeling

---

## Running the Examples

### Prerequisites

```bash
# Install .NET 8.0 SDK
dotnet --version  # Should be 8.0 or higher

# Install PostgreSQL (for MartenDB)
# macOS: brew install postgresql
# Ubuntu: sudo apt-get install postgresql
# Windows: Download from postgresql.org
```

### Setup

1. **Create a new .NET project**:
```bash
mkdir DotNetExamples
cd DotNetExamples
dotnet new web -n BlogApi
cd BlogApi
```

2. **Install required packages**:
```bash
# ASP.NET Core packages
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
dotnet add package Swashbuckle.AspNetCore

# Wolverine
dotnet add package Wolverine
dotnet add package Wolverine.Http

# MartenDB
dotnet add package Marten
dotnet add package Marten.AspNetCore

# Validation
dotnet add package FluentValidation.AspNetCore

# Testing (optional)
dotnet add package xunit
dotnet add package FluentAssertions
dotnet add package Microsoft.AspNetCore.Mvc.Testing
```

3. **Configure PostgreSQL connection**:
```bash
# Set connection string in appsettings.json or environment variable
export ConnectionStrings__DefaultConnection="Host=localhost;Database=blog_api;Username=postgres;Password=postgres"
```

### Running Example 1: RESTful API

```bash
# Copy the web-api.example.cs code to Program.cs
# Or create separate files for each class

# Run the application
dotnet run

# Test the API
curl http://localhost:5000/api/posts
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}'
```

**API Endpoints**:
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/posts` - Get all posts (paginated)
- `GET /api/posts/{id}` - Get post by ID
- `POST /api/posts` - Create new post (authenticated)
- `PUT /api/posts/{id}` - Update post (authenticated)
- `DELETE /api/posts/{id}` - Delete post (authenticated)

### Running Example 2: Event Sourcing

```bash
# Copy the event-sourcing.example.cs code to Program.cs
# Or create separate files for each class

# Run the application
dotnet run

# Test event sourcing
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":"123","items":[{"productId":"P1","quantity":2,"price":29.99}]}'

# Get order (from read model)
curl http://localhost:5000/api/orders/{orderId}

# Get order history (from event stream)
curl http://localhost:5000/api/orders/{orderId}/history
```

**API Endpoints**:
- `POST /api/orders` - Create order (generates OrderCreated event)
- `POST /api/orders/{id}/ship` - Ship order (generates OrderShipped event)
- `POST /api/orders/{id}/complete` - Complete order (generates OrderCompleted event)
- `GET /api/orders/{id}` - Get order from read model
- `GET /api/orders/{id}/history` - Get full event history
- `GET /api/orders/{id}/at/{timestamp}` - Get order state at specific time

---

## Code Organization Patterns

### File Structure (Recommended)

```
src/
├── Controllers/               # API controllers
│   ├── PostsController.cs
│   └── AuthController.cs
├── Commands/                  # Command definitions
│   ├── CreatePostCommand.cs
│   └── UpdatePostCommand.cs
├── Queries/                   # Query definitions
│   ├── GetPostsQuery.cs
│   └── GetPostByIdQuery.cs
├── Handlers/                  # Command/Query handlers
│   ├── CreatePostHandler.cs
│   └── GetPostsHandler.cs
├── Entities/                  # Domain entities
│   └── Post.cs
├── Events/                    # Event definitions (event sourcing)
│   ├── OrderCreated.cs
│   └── OrderShipped.cs
├── Projections/               # Read model projections
│   └── OrderProjection.cs
├── DTOs/                      # Data transfer objects
│   ├── PostResponse.cs
│   └── CreatePostRequest.cs
├── Services/                  # Domain services
│   └── AuthService.cs
└── Program.cs                 # Application startup
```

### Layering Pattern

```
┌─────────────────────────────┐
│   Controllers / Endpoints   │  ← HTTP layer
├─────────────────────────────┤
│   Commands / Queries        │  ← Application layer
├─────────────────────────────┤
│   Handlers                  │  ← Business logic layer
├─────────────────────────────┤
│   Entities / Aggregates     │  ← Domain layer
├─────────────────────────────┤
│   MartenDB / Wolverine      │  ← Infrastructure layer
└─────────────────────────────┘
```

---

## Key Patterns Demonstrated

### 1. CQRS (Command Query Responsibility Segregation)

**Commands** (write operations):
```csharp
public record CreatePostCommand(string Title, string Content, string AuthorId);
```

**Queries** (read operations):
```csharp
public record GetPostsQuery(int Page = 1, int PageSize = 20);
```

### 2. Message-Driven Architecture (Wolverine)

```csharp
// Command handler
public class CreatePostHandler
{
    public async Task<PostResponse> Handle(CreatePostCommand command)
    {
        // Business logic
    }
}

// Invocation
var result = await _messageBus.InvokeAsync<PostResponse>(command);
```

### 3. Event Sourcing with MartenDB

```csharp
// Event
public record OrderCreated(Guid OrderId, string CustomerId, DateTime OccurredAt);

// Aggregate
public class OrderAggregate
{
    public void Apply(OrderCreated evt) { /* Update state */ }
}

// Append to stream
_session.Events.StartStream<OrderAggregate>(orderId, new OrderCreated(...));
```

### 4. Projections (Read Models)

```csharp
public class OrderProjection : SingleStreamProjection<OrderReadModel>
{
    public OrderReadModel Create(OrderCreated evt)
    {
        return new OrderReadModel { Id = evt.OrderId, ... };
    }
}
```

### 5. Authentication & Authorization

```csharp
// JWT authentication
services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options => { /* JWT config */ });

// Controller authorization
[Authorize]
[HttpPost]
public async Task<ActionResult> CreatePost([FromBody] CreatePostRequest request)
```

---

## Testing Examples

### Unit Testing (xUnit + FluentAssertions)

```csharp
public class CreatePostHandlerTests
{
    [Fact]
    public async Task Handle_WithValidCommand_ShouldCreatePost()
    {
        // Arrange
        var command = new CreatePostCommand("Test Title", "Test Content", "user123");

        // Act
        var result = await _handler.Handle(command);

        // Assert
        result.Should().NotBeNull();
        result.Title.Should().Be(command.Title);
    }
}
```

### Integration Testing (WebApplicationFactory)

```csharp
public class PostsControllerIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task GetPosts_ShouldReturnOk()
    {
        // Arrange
        var client = _factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/posts");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

---

## Best Practices Demonstrated

1. **Separation of Concerns**: Clear boundaries between controllers, handlers, and domain logic
2. **Validation**: Request validation with FluentValidation or data annotations
3. **Error Handling**: Consistent error responses and logging
4. **Security**: JWT authentication, authorization policies, input sanitization
5. **Performance**: Pagination, async/await, efficient queries
6. **Testability**: Dependency injection, interfaces, unit and integration tests
7. **Documentation**: XML comments, Swagger/OpenAPI specs
8. **Maintainability**: Consistent patterns, clear naming conventions

---

## Additional Resources

- **Official Documentation**:
  - [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/)
  - [Wolverine](https://wolverine.netlify.app/)
  - [MartenDB](https://martendb.io/)

- **Related Skills**:
  - `skills/dotnet-framework/SKILL.md` - Quick reference guide
  - `skills/dotnet-framework/REFERENCE.md` - Comprehensive guide
  - `skills/dotnet-framework/templates/` - Code generation templates

- **Testing**:
  - [xUnit](https://xunit.net/)
  - [FluentAssertions](https://fluentassertions.com/)
  - [Testcontainers](https://dotnet.testcontainers.org/)

---

**Note**: These examples are designed for educational purposes and demonstrate best practices. For production use, consider additional concerns like:
- Comprehensive error handling and logging
- Rate limiting and throttling
- Caching strategies
- Monitoring and observability
- Database migrations and versioning
- Deployment and scaling considerations
