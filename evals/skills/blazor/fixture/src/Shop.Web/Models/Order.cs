namespace Shop.Web.Models;

public record Order(Guid Id, string Customer, string Status);

public record OrderNote(Guid OrderId, string Author, string Text, DateTimeOffset At);
