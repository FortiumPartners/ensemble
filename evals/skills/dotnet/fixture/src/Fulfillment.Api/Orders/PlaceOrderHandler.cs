using Marten;

namespace Fulfillment.Api.Orders;

public static class PlaceOrderHandler
{
    public static async Task Handle(PlaceOrder command, IDocumentSession session, CancellationToken ct)
    {
        session.Events.StartStream<Order>(command.OrderId, new OrderPlaced(command.OrderId, command.CustomerId, command.Total));
        await session.SaveChangesAsync(ct);
    }
}
