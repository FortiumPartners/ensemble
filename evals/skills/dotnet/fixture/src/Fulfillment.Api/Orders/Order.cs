namespace Fulfillment.Api.Orders;

public class Order
{
    public Guid Id { get; set; }
    public string CustomerId { get; set; } = "";
    public string Status { get; set; } = "";
    public decimal Total { get; set; }

    public void Apply(OrderPlaced placed)
    {
        Id = placed.OrderId;
        CustomerId = placed.CustomerId;
        Total = placed.Total;
        Status = "Placed";
    }
}
