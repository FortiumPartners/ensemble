using Wolverine;

namespace Fulfillment.Api.Orders;

public static class OrderEndpoints
{
    public static void MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/orders", async (PlaceOrderRequest request, IMessageBus bus, CancellationToken ct) =>
        {
            var orderId = Guid.NewGuid();
            await bus.InvokeAsync(new PlaceOrder(orderId, request.CustomerId, request.Total), ct);
            return Results.Created($"/orders/{orderId}", new { orderId });
        });
    }
}
