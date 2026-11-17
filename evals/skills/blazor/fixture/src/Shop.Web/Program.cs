using Microsoft.FluentUI.AspNetCore.Components;
using Shop.Web.Components;
using Shop.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddFluentUIComponents();
builder.Services.AddSingleton<IOrderService, InMemoryOrderService>();
builder.Services.AddSingleton<IOrderChangeNotifier, OrderChangeNotifier>();
builder.Services.AddSingleton<IAuditLog, AuditLog>();

var app = builder.Build();

app.UseStaticFiles();
app.UseAntiforgery();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
