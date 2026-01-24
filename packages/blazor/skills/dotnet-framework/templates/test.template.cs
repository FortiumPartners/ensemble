using Xunit;
using FluentAssertions;
using Moq;
using Microsoft.Extensions.Logging;
using Marten;
using {{Namespace}}.Entities;
using {{Namespace}}.Handlers;
using {{Namespace}}.DTOs;
using {{Namespace}}.Events;
using {{Namespace}}.Projections;

namespace {{Namespace}}.Tests;

// ============================================================================
// ENTITY TESTS (Domain Logic)
// ============================================================================

public class {{EntityName}}EntityTests
{
    [Fact]
    public void Create_WithValidData_ShouldCreateEntity()
    {
        // Arrange
        var {{propertyName}} = "Test {{PropertyName}}";
        var {{secondPropertyName}} = "Test {{SecondPropertyName}}";
        var createdBy = "testuser";

        // Act
        var entity = {{EntityName}}.Create({{propertyName}}, {{secondPropertyName}}, createdBy);

        // Assert
        entity.Should().NotBeNull();
        entity.Id.Should().NotBe(Guid.Empty);
        entity.{{PropertyName}}.Should().Be({{propertyName}});
        entity.{{SecondPropertyName}}.Should().Be({{secondPropertyName}});
        entity.CreatedBy.Should().Be(createdBy);
        entity.IsDeleted.Should().BeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(null)]
    public void Create_WithInvalid{{PropertyName}}_ShouldThrowException(string invalid{{PropertyName}})
    {
        // Arrange
        var {{secondPropertyName}} = "Test {{SecondPropertyName}}";
        var createdBy = "testuser";

        // Act
        Action act = () => {{EntityName}}.Create(invalid{{PropertyName}}, {{secondPropertyName}}, createdBy);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*{{PropertyName}}*");
    }

    [Fact]
    public void Update_WithValidData_ShouldUpdateEntity()
    {
        // Arrange
        var entity = {{EntityName}}.Create("Initial", "Initial", "testuser");
        var new{{PropertyName}} = "Updated {{PropertyName}}";
        var new{{SecondPropertyName}} = "Updated {{SecondPropertyName}}";
        var updatedBy = "testuser2";

        // Act
        entity.Update(new{{PropertyName}}, new{{SecondPropertyName}}, updatedBy);

        // Assert
        entity.{{PropertyName}}.Should().Be(new{{PropertyName}});
        entity.{{SecondPropertyName}}.Should().Be(new{{SecondPropertyName}});
        entity.UpdatedBy.Should().Be(updatedBy);
        entity.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public void Delete_ShouldSoftDeleteEntity()
    {
        // Arrange
        var entity = {{EntityName}}.Create("Test", "Test", "testuser");
        var deletedBy = "testuser2";

        // Act
        entity.Delete(deletedBy);

        // Assert
        entity.IsDeleted.Should().BeTrue();
        entity.DeletedBy.Should().Be(deletedBy);
        entity.DeletedAt.Should().NotBeNull();
    }

    [Fact]
    public void IsValid_WithValidData_ShouldReturnTrue()
    {
        // Arrange
        var entity = {{EntityName}}.Create("Test", "Test", "testuser");

        // Act
        var isValid = entity.IsValid(out var errors);

        // Assert
        isValid.Should().BeTrue();
        errors.Should().BeEmpty();
    }
}

// ============================================================================
// COMMAND HANDLER TESTS
// ============================================================================

public class Create{{EntityName}}HandlerTests
{
    private readonly Mock<IDocumentSession> _sessionMock;
    private readonly Mock<ILogger<Create{{EntityName}}Handler>> _loggerMock;
    private readonly Create{{EntityName}}Handler _handler;

    public Create{{EntityName}}HandlerTests()
    {
        _sessionMock = new Mock<IDocumentSession>();
        _loggerMock = new Mock<ILogger<Create{{EntityName}}Handler>>();
        _handler = new Create{{EntityName}}Handler(_sessionMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task Handle_WithValidCommand_ShouldCreateAndReturn{{EntityName}}()
    {
        // Arrange
        var command = new Create{{EntityName}}Command(
            "Test {{PropertyName}}",
            "Test {{SecondPropertyName}}",
            "testuser");

        // Act
        var result = await _handler.Handle(command);

        // Assert
        result.Should().NotBeNull();
        result.{{PropertyName}}.Should().Be(command.{{PropertyName}});
        result.{{SecondPropertyName}}.Should().Be(command.{{SecondPropertyName}});

        _sessionMock.Verify(x => x.Store(It.IsAny<{{EntityName}}>()), Times.Once);
        _sessionMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WithEmpty{{PropertyName}}_ShouldThrowValidationException()
    {
        // Arrange
        var command = new Create{{EntityName}}Command(
            "",
            "Test {{SecondPropertyName}}",
            "testuser");

        // Act
        Func<Task> act = async () => await _handler.Handle(command);

        // Assert
        await act.Should().ThrowAsync<ValidationException>()
            .WithMessage("*{{PropertyName}}*");
    }
}

public class Update{{EntityName}}HandlerTests
{
    private readonly Mock<IDocumentSession> _sessionMock;
    private readonly Mock<ILogger<Update{{EntityName}}Handler>> _loggerMock;
    private readonly Update{{EntityName}}Handler _handler;

    public Update{{EntityName}}HandlerTests()
    {
        _sessionMock = new Mock<IDocumentSession>();
        _loggerMock = new Mock<ILogger<Update{{EntityName}}Handler>>();
        _handler = new Update{{EntityName}}Handler(_sessionMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task Handle_WithExistingEntity_ShouldUpdateAndReturn{{EntityName}}()
    {
        // Arrange
        var entityId = Guid.NewGuid();
        var existingEntity = {{EntityName}}.Create("Old", "Old", "testuser");
        typeof({{EntityName}}).GetProperty("Id")!.SetValue(existingEntity, entityId);

        _sessionMock.Setup(x => x.LoadAsync<{{EntityName}}>(entityId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingEntity);

        var command = new Update{{EntityName}}Command(
            entityId,
            "New {{PropertyName}}",
            "New {{SecondPropertyName}}",
            "testuser2");

        // Act
        var result = await _handler.Handle(command);

        // Assert
        result.Should().NotBeNull();
        result!.{{PropertyName}}.Should().Be(command.{{PropertyName}});
        result.{{SecondPropertyName}}.Should().Be(command.{{SecondPropertyName}});

        _sessionMock.Verify(x => x.Update(It.IsAny<{{EntityName}}>()), Times.Once);
        _sessionMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WithNonExistentEntity_ShouldReturnNull()
    {
        // Arrange
        var entityId = Guid.NewGuid();
        _sessionMock.Setup(x => x.LoadAsync<{{EntityName}}>(entityId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(({{EntityName}}?)null);

        var command = new Update{{EntityName}}Command(
            entityId,
            "New {{PropertyName}}",
            "New {{SecondPropertyName}}",
            "testuser");

        // Act
        var result = await _handler.Handle(command);

        // Assert
        result.Should().BeNull();
        _sessionMock.Verify(x => x.Update(It.IsAny<{{EntityName}}>()), Times.Never);
    }
}

// ============================================================================
// QUERY HANDLER TESTS
// ============================================================================

public class Get{{EntityNamePlural}}HandlerTests
{
    private readonly Mock<IQuerySession> _sessionMock;
    private readonly Mock<ILogger<Get{{EntityNamePlural}}Handler>> _loggerMock;
    private readonly Get{{EntityNamePlural}}Handler _handler;

    public Get{{EntityNamePlural}}HandlerTests()
    {
        _sessionMock = new Mock<IQuerySession>();
        _loggerMock = new Mock<ILogger<Get{{EntityNamePlural}}Handler>>();
        _handler = new Get{{EntityNamePlural}}Handler(_sessionMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task Handle_WithValidQuery_ShouldReturnPagedResults()
    {
        // Arrange
        var entities = new List<{{EntityName}}>
        {
            {{EntityName}}.Create("Test 1", "Desc 1", "user1"),
            {{EntityName}}.Create("Test 2", "Desc 2", "user2")
        };

        // Setup queryable mock (simplified - in real tests use TestableQuerySession or in-memory DB)
        var query = new Get{{EntityNamePlural}}Query(Page: 1, PageSize: 10);

        // Act & Assert
        // Note: Full integration test would use real IQuerySession with test database
        // This is a simplified unit test example
    }
}

// ============================================================================
// EVENT SOURCING TESTS
// ============================================================================

public class {{EntityName}}AggregateTests
{
    [Fact]
    public void Create_ShouldGenerateCreatedEvent()
    {
        // Arrange
        var id = Guid.NewGuid();
        var {{propertyName}} = "Test {{PropertyName}}";
        var {{secondPropertyName}} = "Test {{SecondPropertyName}}";
        var triggeredBy = "testuser";

        // Act
        var evt = {{EntityName}}Aggregate.Create(id, {{propertyName}}, {{secondPropertyName}}, triggeredBy);

        // Assert
        evt.Should().NotBeNull();
        evt.{{EntityName}}Id.Should().Be(id);
        evt.{{PropertyName}}.Should().Be({{propertyName}});
        evt.{{SecondPropertyName}}.Should().Be({{secondPropertyName}});
        evt.TriggeredBy.Should().Be(triggeredBy);
    }

    [Fact]
    public void Apply_{{EntityName}}Created_ShouldSetInitialState()
    {
        // Arrange
        var aggregate = new {{EntityName}}Aggregate();
        var evt = new {{EntityName}}Created(
            Guid.NewGuid(),
            "Test",
            "Test",
            "testuser",
            DateTime.UtcNow);

        // Act
        aggregate.Apply(evt);

        // Assert
        aggregate.Id.Should().Be(evt.{{EntityName}}Id);
        aggregate.{{PropertyName}}.Should().Be(evt.{{PropertyName}});
        aggregate.CreatedBy.Should().Be(evt.TriggeredBy);
        aggregate.IsDeleted.Should().BeFalse();
        aggregate.Version.Should().Be(1);
    }

    [Fact]
    public void Update_ShouldGenerateUpdatedEvent()
    {
        // Arrange
        var aggregate = new {{EntityName}}Aggregate();
        var createEvt = new {{EntityName}}Created(
            Guid.NewGuid(),
            "Initial",
            "Initial",
            "testuser",
            DateTime.UtcNow);
        aggregate.Apply(createEvt);

        // Act
        var updateEvt = aggregate.Update("Updated", "Updated", "testuser2");

        // Assert
        updateEvt.Should().NotBeNull();
        updateEvt.{{PropertyName}}.Should().Be("Updated");
        updateEvt.TriggeredBy.Should().Be("testuser2");
    }

    [Fact]
    public void Delete_OnDeletedAggregate_ShouldThrowException()
    {
        // Arrange
        var aggregate = new {{EntityName}}Aggregate();
        var createEvt = new {{EntityName}}Created(
            Guid.NewGuid(),
            "Test",
            "Test",
            "testuser",
            DateTime.UtcNow);
        aggregate.Apply(createEvt);

        var deleteEvt = new {{EntityName}}Deleted(
            aggregate.Id,
            "testuser",
            DateTime.UtcNow);
        aggregate.Apply(deleteEvt);

        // Act
        Action act = () => aggregate.Delete("testuser2");

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*already deleted*");
    }
}

// ============================================================================
// PROJECTION TESTS
// ============================================================================

public class {{EntityName}}ProjectionTests
{
    private readonly {{EntityName}}Projection _projection;

    public {{EntityName}}ProjectionTests()
    {
        _projection = new {{EntityName}}Projection();
    }

    [Fact]
    public void Create_From{{EntityName}}Created_ShouldCreateReadModel()
    {
        // Arrange
        var evt = new {{EntityName}}Created(
            Guid.NewGuid(),
            "Test {{PropertyName}}",
            "Test {{SecondPropertyName}}",
            "testuser",
            DateTime.UtcNow);

        // Act
        var readModel = _projection.Create(evt);

        // Assert
        readModel.Should().NotBeNull();
        readModel.Id.Should().Be(evt.{{EntityName}}Id);
        readModel.{{PropertyName}}.Should().Be(evt.{{PropertyName}});
        readModel.CreatedBy.Should().Be(evt.TriggeredBy);
        readModel.EventCount.Should().Be(1);
    }

    [Fact]
    public void Apply_{{EntityName}}Updated_ShouldUpdateReadModel()
    {
        // Arrange
        var createEvt = new {{EntityName}}Created(
            Guid.NewGuid(),
            "Initial",
            "Initial",
            "testuser",
            DateTime.UtcNow);
        var readModel = _projection.Create(createEvt);

        var updateEvt = new {{EntityName}}Updated(
            readModel.Id,
            "Updated",
            "Updated",
            "testuser2",
            DateTime.UtcNow);

        // Act
        _projection.Apply(updateEvt, readModel);

        // Assert
        readModel.{{PropertyName}}.Should().Be("Updated");
        readModel.UpdatedBy.Should().Be("testuser2");
        readModel.EventCount.Should().Be(2);
    }
}

// ============================================================================
// INTEGRATION TEST HELPERS
// ============================================================================

/*
 * Integration tests with real MartenDB (using Testcontainers):
 *
 * public class {{EntityName}}IntegrationTests : IAsyncLifetime
 * {
 *     private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
 *         .WithImage("postgres:15")
 *         .Build();
 *
 *     private IDocumentStore _store = null!;
 *
 *     public async Task InitializeAsync()
 *     {
 *         await _postgres.StartAsync();
 *
 *         _store = DocumentStore.For(opts =>
 *         {
 *             opts.Connection(_postgres.GetConnectionString());
 *             opts.AutoCreateSchemaObjects = AutoCreate.All;
 *             opts.Events.Projections.Add<{{EntityName}}Projection>(ProjectionLifecycle.Inline);
 *         });
 *     }
 *
 *     public async Task DisposeAsync()
 *     {
 *         _store.Dispose();
 *         await _postgres.DisposeAsync();
 *     }
 *
 *     [Fact]
 *     public async Task FullWorkflow_CreateUpdateDelete_ShouldWork()
 *     {
 *         await using var session = _store.LightweightSession();
 *
 *         // Test full CRUD workflow with real database
 *     }
 * }
 */
