namespace Shop.Web.Services;

public class OrderChangeNotifier : IOrderChangeNotifier, IDisposable
{
    private readonly Timer _poll;

    public OrderChangeNotifier()
    {
        _poll = new Timer(_ => Poll(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
    }

    public event Action<Guid>? OrderChanged;

    private void Poll()
    {
        // Looks for changed orders in the order store; none are simulated here.
        OrderChanged?.Invoke(Guid.Empty);
    }

    public void Dispose() => _poll.Dispose();
}
