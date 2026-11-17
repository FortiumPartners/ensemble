using Shop.Web.Models;

namespace Shop.Web.Services;

public class InMemoryOrderService : IOrderService
{
    private readonly List<Order> _orders =
    [
        new(Guid.Parse("a1000000-0000-0000-0000-000000000001"), "Ada Lovelace", "Packed"),
        new(Guid.Parse("a1000000-0000-0000-0000-000000000002"), "Grace Hopper", "Shipped"),
    ];

    private readonly List<OrderNote> _notes = [];

    public Task<IReadOnlyList<Order>> GetOrdersAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Order>>(_orders.ToList());

    public Task AddNoteAsync(Guid orderId, string author, string text, CancellationToken ct = default)
    {
        _notes.Add(new OrderNote(orderId, author, text, DateTimeOffset.UtcNow));
        return Task.CompletedTask;
    }
}
