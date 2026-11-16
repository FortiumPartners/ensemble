namespace Fulfillment.Api.Orders;

public record OrderPlaced(Guid OrderId, string CustomerId, decimal Total);
