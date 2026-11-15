namespace Shop.Web.Services;

public class AuditLog : IAuditLog
{
    private readonly List<string> _entries = [];

    public Task RecordViewAsync(string page, CancellationToken ct = default)
    {
        _entries.Add($"{DateTimeOffset.UtcNow:O} viewed {page}");
        return Task.CompletedTask;
    }
}
