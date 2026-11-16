namespace ShopApp;

public record CartItem(double Price, int Quantity);

/// <summary>Small cart module.</summary>
public static class Cart
{
    /// <summary>Sum of Price * Quantity over the items.</summary>
    public static double CartTotal(IEnumerable<CartItem> items)
    {
        return items.Sum(item => item.Price * item.Quantity);
    }

    /// <summary>
    /// Total after a percentage discount.
    /// A discount above 100 percent must never make the total negative: the result is clamped at 0.
    /// BUG (reported): ApplyDiscount(100, 150) returns -50.
    /// </summary>
    public static double ApplyDiscount(double total, double percent)
    {
        return total - (total * percent) / 100;
    }
}
