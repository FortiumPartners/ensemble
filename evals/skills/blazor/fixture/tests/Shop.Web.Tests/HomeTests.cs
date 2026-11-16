using Bunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FluentUI.AspNetCore.Components;
using Shop.Web.Components.Pages;
using Shop.Web.Models;
using Shop.Web.Services;
using Xunit;

namespace Shop.Web.Tests;

public class HomeTests : TestContext
{
    private sealed class FakeOrders : IOrderService
    {
        public Task<IReadOnlyList<Order>> GetOrdersAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<Order>>([new Order(Guid.NewGuid(), "Test Customer", "Packed")]);

        public Task AddNoteAsync(Guid orderId, string author, string text, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    public HomeTests()
    {
        Services.AddSingleton<IOrderService>(new FakeOrders());
        Services.AddFluentUIComponents();
        JSInterop.Mode = JSRuntimeMode.Loose;
    }

    [Fact]
    public void Home_lists_the_orders_it_loads()
    {
        var cut = RenderComponent<Home>();

        cut.WaitForAssertion(() => Assert.Contains("Test Customer", cut.Markup));
    }
}
