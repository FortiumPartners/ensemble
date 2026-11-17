using Shop.Web.Models;

namespace Shop.Web.Services;

public interface IOrderService
{
    Task<IReadOnlyList<Order>> GetOrdersAsync(CancellationToken ct = default);

    Task AddNoteAsync(Guid orderId, string author, string text, CancellationToken ct = default);
}
