using Fulfillment.Api.Orders;
using Marten;
using Wolverine;
using Wolverine.Marten;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMarten(opts =>
    {
        opts.Connection(builder.Configuration.GetConnectionString("Marten")!);
    })
    .IntegrateWithWolverine();

builder.Host.UseWolverine();

var app = builder.Build();

app.MapOrderEndpoints();

app.Run();
