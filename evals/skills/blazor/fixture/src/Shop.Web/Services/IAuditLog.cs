namespace Shop.Web.Services;

/// <summary>Writes one audit entry per call; calling it twice records two entries.</summary>
public interface IAuditLog
{
    Task RecordViewAsync(string page, CancellationToken ct = default);
}
