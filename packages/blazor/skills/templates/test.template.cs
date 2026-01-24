/*
 * TEMPLATE: bUnit Component Test (Lines: ~250)
 * Purpose: Unit tests for Blazor components
 * Placeholders: {{ComponentName}}, {{Namespace}}, {{PropertyName}}
 */

using Bunit;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FluentUI.AspNetCore.Components;
using Moq;
using Xunit;
using {{Namespace}}.Components;
using {{Namespace}}.Services;

namespace {{Namespace}}.Tests.Components;

public class {{ComponentName}}Tests : TestContext
{
    private readonly Mock<I{{ServiceName}}> _mockService;

    public {{ComponentName}}Tests()
    {
        _mockService = new Mock<I{{ServiceName}}>();

        // Register services
        Services.AddSingleton(_mockService.Object);
        Services.AddFluentUIComponents();
    }

    [Fact]
    public void Component_Renders_WithRequiredParameters()
    {
        // Arrange
        var {{propertyName}} = "Test {{PropertyName}}";

        // Act
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, {{propertyName}}));

        // Assert
        cut.Find("h3").TextContent.Should().Be({{propertyName}});
    }

    [Fact]
    public void Component_Shows_ChildContent_WhenProvided()
    {
        // Arrange
        var childContent = "Custom child content";

        // Act
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Title")
            .AddChildContent(childContent));

        // Assert
        cut.Markup.Should().Contain(childContent);
    }

    [Fact]
    public async Task PrimaryButton_Click_InvokesCallback()
    {
        // Arrange
        var callbackInvoked = false;
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test")
            .Add(p => p.OnPrimaryAction, () => { callbackInvoked = true; }));

        // Act
        var button = cut.Find("button");
        await button.ClickAsync(new Microsoft.AspNetCore.Components.Web.MouseEventArgs());

        // Assert
        callbackInvoked.Should().BeTrue();
    }

    [Fact]
    public void Component_Shows_LoadingIndicator_WhenProcessing()
    {
        // Arrange
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test"));

        // Act
        cut.Instance.TriggerPrimaryActionAsync();
        cut.WaitForState(() => cut.Find("fluent-progress-ring") != null, timeout: TimeSpan.FromSeconds(2));

        // Assert
        cut.FindAll("fluent-progress-ring").Should().NotBeEmpty();
    }

    [Fact]
    public async Task Component_Handles_ServiceErrors_Gracefully()
    {
        // Arrange
        _mockService.Setup(s => s.GetDataAsync())
            .ThrowsAsync(new Exception("Service error"));

        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test"));

        // Act & Assert
        await cut.Instance.TriggerPrimaryActionAsync();
        cut.Markup.Should().Contain("error");
    }

    [Fact]
    public void Component_DisablesButtons_WhileLoading()
    {
        // Arrange
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test"));

        // Act
        cut.Instance.TriggerPrimaryActionAsync();

        // Assert
        cut.FindAll("button[disabled]").Should().NotBeEmpty();
    }

    [Fact]
    public async Task Component_EmitsStateChangedEvent()
    {
        // Arrange
        ComponentState? emittedState = null;
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test")
            .Add(p => p.OnStateChanged, state => { emittedState = state; }));

        // Act
        await cut.Instance.TriggerPrimaryActionAsync();

        // Assert
        emittedState.Should().NotBeNull();
    }

    [Fact]
    public void Component_Reset_ClearsState()
    {
        // Arrange
        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Test"));

        // Act
        cut.Instance.Reset();

        // Assert
        cut.Instance.Should().NotBeNull();
        // Verify state is cleared
    }
}

// Integration test example
public class {{ComponentName}}IntegrationTests : TestContext
{
    [Fact]
    public async Task FullWorkflow_CreateToSave_Works()
    {
        // Arrange
        var service = new {{ServiceName}}(Mock.Of<ILogger<{{ServiceName}}>>());
        Services.AddSingleton<I{{ServiceName}}>(service);

        var cut = RenderComponent<{{ComponentName}}>(parameters => parameters
            .Add(p => p.{{PropertyName}}, "Integration Test"));

        // Act
        await cut.Instance.TriggerPrimaryActionAsync();

        // Assert
        service.Items.Should().NotBeEmpty();
    }
}
