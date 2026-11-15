using Fulfillment.Api.Orders;
using Xunit;

namespace Fulfillment.Tests;

public class OrderTests
{
    [Fact]
    public void Applying_OrderPlaced_sets_the_state()
    {
        var id = Guid.NewGuid();
        var order = new Order();

        order.Apply(new OrderPlaced(id, "cust-1", 42m));

        Assert.Equal(id, order.Id);
        Assert.Equal("Placed", order.Status);
        Assert.Equal(42m, order.Total);
    }
}
