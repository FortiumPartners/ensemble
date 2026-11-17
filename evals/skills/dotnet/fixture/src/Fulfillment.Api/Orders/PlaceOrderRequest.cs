namespace Fulfillment.Api.Orders;

public record PlaceOrderRequest(string CustomerId, decimal Total);
