namespace Fulfillment.Api.Orders;

public record PlaceOrder(Guid OrderId, string CustomerId, decimal Total);
