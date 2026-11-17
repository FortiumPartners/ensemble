namespace Shop.Web.Services;

/// <summary>Raised with the id of an order whenever that order changes.</summary>
public interface IOrderChangeNotifier
{
    event Action<Guid>? OrderChanged;
}
