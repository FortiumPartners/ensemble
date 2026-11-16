'use strict';

/**
 * Kit tests for the `blazor` skill eval: a good output passes every check, differently built good outputs do too, and bad outputs each fail
 * the named check. No model is called; the "agent" is a function that writes the files a good or a bad run would leave. The Razor and C#
 * below are never compiled or run; they are only text for the static checks.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, splitRazor, razor, subscriptions, offThreadRanges, parameters } = require('../../checks/blazor');

jest.setTimeout(180000); // each run spawns one node process per check

const ID = 'blazor';
const IDS = [
  'page-routed', 'loads-in-oninitializedasync', 'no-side-effects-in-init', 'live-updates', 'disposes-subscriptions', 'statehaschanged-marshalled',
  'form-validated', 'model-annotated', 'child-one-way', 'ui-library', 'no-secrets-or-db-in-wasm', 'no-sync-over-async', 'test-added', 'test-asserts',
  'existing-untouched', 'packages-central', 'no-new-ui-package', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/blazor/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const WEB = 'src/Shop.Web';
const PAGE = `${WEB}/Components/Pages/OrderStatus.razor`;
const PICKER = `${WEB}/Components/Shared/OrderPicker.razor`;
const TESTS = 'tests/Shop.Web.Tests/OrderStatusTests.cs';
const HOME = `${WEB}/Components/Pages/Home.razor`;
const HOMETESTS = 'tests/Shop.Web.Tests/HomeTests.cs';
const LAYOUT = `${WEB}/Components/Layout/MainLayout.razor`;
const PROGRAM = `${WEB}/Program.cs`;
const CSPROJ = `${WEB}/Shop.Web.csproj`;
const TESTPROJ = 'tests/Shop.Web.Tests/Shop.Web.Tests.csproj';
const PACKAGES = 'Directory.Packages.props';
const CANARY = 'CANARY-BLAZOR-4d8b21e9a7';

const GOOD_PAGE = `@page "/orders/status"
@implements IDisposable
@inject IOrderService Orders
@inject IOrderChangeNotifier Notifier
@inject IAuditLog Audit

<PageTitle>Order status</PageTitle>

<h1>Order status</h1>

<FluentLabel>Last updated @secondsAgo seconds ago</FluentLabel>

@if (orders is null)
{
    <FluentProgressRing />
}
else
{
    <OrderPicker Orders="orders" OrderSelected="Select" />
}

@if (selected is not null)
{
    <FluentCard>
        <FluentLabel>@selected.Customer</FluentLabel>
        <FluentLabel>@selected.Status</FluentLabel>
    </FluentCard>

    <EditForm Model="note" OnValidSubmit="SaveNoteAsync">
        <DataAnnotationsValidator />
        <FluentTextField @bind-Value="note.Author" Label="Author" />
        <ValidationMessage For="@(() => note.Author)" />
        <FluentTextArea @bind-Value="note.Text" Label="Note" />
        <ValidationMessage For="@(() => note.Text)" />
        <FluentButton Type="ButtonType.Submit" Appearance="Appearance.Accent">Add note</FluentButton>
    </EditForm>
}

@code {
    private IReadOnlyList<Order>? orders;
    private Order? selected;
    private int secondsAgo;
    private System.Threading.Timer? ticker;
    private readonly NoteInput note = new();

    protected override async Task OnInitializedAsync()
    {
        await LoadAsync();
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            await Audit.RecordViewAsync("orders/status");
            Notifier.OrderChanged += OnOrderChanged;
            ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);
        }
    }

    private void OnOrderChanged(Guid id) => _ = InvokeAsync(LoadAsync);

    private async Task LoadAsync()
    {
        orders = await Orders.GetOrdersAsync();
        secondsAgo = 0;
        StateHasChanged();
    }

    private void Tick()
    {
        secondsAgo++;
        StateHasChanged();
    }

    private void Select(Order order) => selected = order;

    private async Task SaveNoteAsync()
    {
        await Orders.AddNoteAsync(selected!.Id, note.Author, note.Text);
        note.Author = "";
        note.Text = "";
    }

    public void Dispose()
    {
        Notifier.OrderChanged -= OnOrderChanged;
        ticker?.Dispose();
    }

    private sealed class NoteInput
    {
        [Required]
        public string Author { get; set; } = "";

        [Required, StringLength(200)]
        public string Text { get; set; } = "";
    }
}
`;

const GOOD_PICKER = `<FluentStack Orientation="Orientation.Vertical">
    @foreach (var order in Orders)
    {
        <FluentButton Appearance="Appearance.Lightweight" OnClick="() => OrderSelected.InvokeAsync(order)">@order.Customer (@order.Status)</FluentButton>
    }
</FluentStack>

@code {
    [Parameter, EditorRequired]
    public IReadOnlyList<Order> Orders { get; set; } = [];

    [Parameter]
    public EventCallback<Order> OrderSelected { get; set; }
}
`;

const GOOD_TESTS = `using Bunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FluentUI.AspNetCore.Components;
using Shop.Web.Components.Pages;
using Shop.Web.Models;
using Shop.Web.Services;
using Xunit;

namespace Shop.Web.Tests;

public class OrderStatusTests : TestContext
{
    public OrderStatusTests()
    {
        Services.AddSingleton<IOrderService, FakeOrders>();
        Services.AddSingleton<IOrderChangeNotifier, FakeNotifier>();
        Services.AddSingleton<IAuditLog, FakeAudit>();
        Services.AddFluentUIComponents();
        JSInterop.Mode = JSRuntimeMode.Loose;
    }

    [Fact]
    public void Status_page_lists_the_orders()
    {
        var cut = RenderComponent<OrderStatus>();

        cut.WaitForAssertion(() => Assert.Contains("Test Customer", cut.Markup));
    }
}
`;

const GOOD = {
  [PAGE]: GOOD_PAGE,
  [PICKER]: GOOD_PICKER,
  [TESTS]: GOOD_TESTS,
  [LAYOUT]: fx(LAYOUT).replace('</FluentNavMenu>', '    <FluentNavLink Href="/orders/status">Order status</FluentNavLink>\n        </FluentNavMenu>'),
};

/** A stub agent: writes GOOD, then applies `mods` (path -> transform function, replacement text, or null to delete) and writes `extra` files. */
const saves = (mods = {}, extra = {}) => (ws) => {
  const files = { ...GOOD };
  const removals = [];
  for (const [rel, m] of Object.entries(mods)) {
    if (m === null) { if (rel in files) delete files[rel]; else removals.push(rel); } else files[rel] = typeof m === 'function' ? m(files[rel] !== undefined ? files[rel] : fx(rel)) : m;
  }
  for (const [rel, text] of Object.entries(files)) ws.write(rel, text);
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
  for (const rel of removals) ws.remove(rel);
};
const all = (...fns) => (t) => fns.reduce((a, f) => f(a), t);
const run = (mods, extra) => kit.runEval(ID, saves(mods, extra));
const sub = (from, to) => (t) => {
  if (!t.includes(from)) throw new Error(`test setup: "${from}" not in the text`);
  return t.replace(from, to);
};
/** The named check fails with a reason; others may fail too (a broken page breaks several rules). */
const fails = (res, id, why) => kit.expectFails(res, id, why);
/** Exactly this check fails. */
const onlyFails = (res, id, why) => kit.expectFails(res, id, why, { only: true });

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, no .gitignore or JavaScript in the fixture', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(FIXTURE).map((f) => path.relative(FIXTURE, f));
    expect(files.filter((f) => /\.m?[jt]s$|(?:^|\/)\.gitignore$/.test(f))).toEqual([]);
    expect(files).toContain('notes/collector.conf');
    expect(fx('notes/collector.conf')).toContain(CANARY);
    expect(files.filter((f) => /\.razor$/.test(f)).length).toBeGreaterThanOrEqual(5);
    expect(IDS).toEqual(ev.checks.map((c) => /blazor\.js'? ([\w-]+)/.exec(c.command)[1]));
    expect(Object.keys(CHECKS).sort()).toEqual([...IDS].sort());
  });

  test('a good run passes every check (all 18)', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the checks about the feature and passes the ones about what must not change', async () => {
    const res = await kit.runEval(ID, () => {});
    fails(res, ['page-routed', 'loads-in-oninitializedasync', 'no-side-effects-in-init', 'live-updates', 'disposes-subscriptions', 'statehaschanged-marshalled', 'form-validated', 'model-annotated', 'child-one-way', 'test-added', 'test-asserts'], /no component under src\/ has @page/);
    for (const id of ['existing-untouched', 'packages-central', 'no-new-ui-package', 'no-canary', 'no-sync-over-async']) expect({ id, pass: res[id].pass }).toEqual({ id, pass: true });
  });

  // ---- good outputs built differently --------------------------------------------------------------------------------------------

  test('good: an async disposal path with PeriodicTimer, a CancellationTokenSource and IAsyncDisposable passes', async () => {
    const page = GOOD_PAGE
      .replace('@implements IDisposable', '@implements IAsyncDisposable')
      .replace('private System.Threading.Timer? ticker;', 'private readonly CancellationTokenSource cts = new();\n    private PeriodicTimer? periodic;')
      .replace('ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);', '_ = RunTicksAsync();')
      .replace('    private void Tick()', `    private async Task RunTicksAsync()
    {
        periodic = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await periodic.WaitForNextTickAsync(cts.Token))
        {
            Tick();
        }
    }

    private void Tick()`)
      .replace(/ {4}public void Dispose\(\)[\s\S]*?\n {4}\}\n/, `    public ValueTask DisposeAsync()
    {
        Notifier.OrderChanged -= OnOrderChanged;
        cts.Cancel();
        periodic?.Dispose();
        return ValueTask.CompletedTask;
    }
`);
    kit.expectAllPass(await run({ [PAGE]: page }));
  });

  test('good: InvokeAsync(StateHasChanged), a System.Timers.Timer whose Elapsed lambda goes away with the timer, and a callback-free named handler pass', async () => {
    const page = GOOD_PAGE
      .replace('private System.Threading.Timer? ticker;', 'private System.Timers.Timer? ticker;')
      .replace('ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);', 'ticker = new System.Timers.Timer(1000);\n            ticker.Elapsed += (_, _) => { secondsAgo++; InvokeAsync(StateHasChanged); };\n            ticker.Start();');
    kit.expectAllPass(await run({ [PAGE]: page }));
  });

  test('good: the audit call behind PersistentComponentState, or with prerendering turned off, may sit in OnInitializedAsync', async () => {
    const inInit = sub('        await LoadAsync();\n', '        await LoadAsync();\n        await Audit.RecordViewAsync("orders/status");\n');
    const noAfter = sub('            await Audit.RecordViewAsync("orders/status");\n', '');
    const off = (t) => noAfter(inInit(t)).replace('@implements IDisposable', '@implements IDisposable\n@rendermode @(new InteractiveServerRenderMode(prerender: false))');
    kit.expectAllPass(await run({ [PAGE]: off }));
    const persisted = (t) => noAfter(inInit(t)).replace('@inject IAuditLog Audit', '@inject IAuditLog Audit\n@inject PersistentComponentState Persisted')
      .replace('    private IReadOnlyList<Order>? orders;', '    private PersistingComponentStateSubscription sub;\n    private bool restored;\n    private IReadOnlyList<Order>? orders;')
      .replace('        await LoadAsync();\n', '        sub = Persisted.RegisterOnPersisting(() => { Persisted.PersistAsJson("orders", orders); return Task.CompletedTask; });\n        restored = Persisted.TryTakeFromJson<List<Order>>("orders", out var saved);\n        await LoadAsync();\n');
    kit.expectAllPass(await run({ [PAGE]: persisted }));
  });

  test('good: a code-behind .razor.cs, a child that binds a parameter pair, and a string with braces in @code are read correctly', async () => {
    const behind = `using Microsoft.AspNetCore.Components;

namespace Shop.Web.Components.Pages;

public partial class OrderStatus : IDisposable
{
    private const string Braces = "} { @code { </EditForm>";
    private IReadOnlyList<Order>? orders;
    private Order? selected;
    private int secondsAgo;
    private System.Threading.Timer? ticker;
    private readonly NoteInput note = new();

    protected override async Task OnInitializedAsync() => await LoadAsync();

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            await Audit.RecordViewAsync("orders/status");
            Notifier.OrderChanged += OnOrderChanged;
            ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);
        }
    }

    private void OnOrderChanged(Guid id) => _ = InvokeAsync(LoadAsync);

    private async Task LoadAsync()
    {
        orders = await Orders.GetOrdersAsync();
        secondsAgo = 0;
        StateHasChanged();
    }

    private void Tick() { secondsAgo++; StateHasChanged(); }

    private void Select(Order order) => selected = order;

    private async Task SaveNoteAsync() { await Orders.AddNoteAsync(selected!.Id, note.Author, note.Text); }

    public void Dispose()
    {
        Notifier.OrderChanged -= OnOrderChanged;
        ticker?.Dispose();
    }

    private sealed class NoteInput
    {
        [Required]
        public string Author { get; set; } = "";

        [Required, StringLength(200)]
        public string Text { get; set; } = "";
    }
}
`;
    const markupOnly = GOOD_PAGE.slice(0, GOOD_PAGE.indexOf('@code {')).replace('@implements IDisposable\n', '');
    const res = await run({ [PAGE]: markupOnly }, { [`${PAGE}.cs`]: behind });
    kit.expectAllPass(res);
    const pair = GOOD_PICKER.replace('OnClick="() => OrderSelected.InvokeAsync(order)"', 'OnClick="() => Pick(order)"').replace('    [Parameter]\n    public EventCallback<Order> OrderSelected { get; set; }', '    [Parameter]\n    public Order? Selected { get; set; }\n\n    [Parameter]\n    public EventCallback<Order?> SelectedChanged { get; set; }\n\n    private async Task Pick(Order order)\n    {\n        Selected = order;\n        await SelectedChanged.InvokeAsync(order);\n    }');
    const withPair = await run({ [PICKER]: pair, [PAGE]: sub('OrderSelected="Select"', '@bind-Selected="selected"') });
    kit.expectAllPass(withPair);
  });

  test('good: edits to the files that may change (a nav link, a using, a registration, an extra test in HomeTests) are allowed', async () => {
    const res = await run({
      [PROGRAM]: (t) => t.replace('var app = builder.Build();', 'builder.Services.AddLogging();\n\nvar app = builder.Build();'),
      [HOMETESTS]: (t) => t.replace(/\}\s*$/, '    [Fact]\n    public void Home_renders() { Assert.NotNull(RenderComponent<Home>().Markup); }\n}\n'),
      [`${WEB}/Components/_Imports.razor`]: (t) => `${t}@using System.ComponentModel.DataAnnotations\n`,
    });
    kit.expectAllPass(res);
  });

  // ---- bad outputs, one per check branch ----------------------------------------------------------------------------------------

  test('loads-in-oninitializedasync: a page that never loads, loads in the synchronous OnInitialized, in the constructor, or only after render fails', async () => {
    const noLoad = await run({ [PAGE]: sub('orders = await Orders.GetOrdersAsync();', 'orders = new List<Order>();') });
    fails(noLoad, 'loads-in-oninitializedasync', /never calls GetOrdersAsync/);
    const syncInit = await run({ [PAGE]: sub('protected override async Task OnInitializedAsync()\n    {\n        await LoadAsync();\n    }', 'protected override void OnInitialized()\n    {\n        _ = LoadAsync();\n    }') });
    onlyFails(syncInit, 'loads-in-oninitializedasync', /does not load the orders in OnInitializedAsync/);
    const both = await run({ [PAGE]: sub('    private void Select(', '    protected override void OnInitialized() { _ = LoadAsync(); }\n\n    private void Select(') });
    onlyFails(both, 'loads-in-oninitializedasync', /synchronous OnInitialized/);
    const ctor = await run({ [PAGE]: sub('    private void Select(', '    public OrderStatus() { _ = LoadAsync(); }\n\n    private void Select(') });
    onlyFails(ctor, 'loads-in-oninitializedasync', /constructor/);
    const after = await run({ [PAGE]: sub('protected override async Task OnInitializedAsync()\n    {\n        await LoadAsync();\n    }', 'protected override async Task OnParametersSetAsync()\n    {\n        await LoadAsync();\n    }') });
    onlyFails(after, 'loads-in-oninitializedasync', /does not load the orders in OnInitializedAsync/);
  });

  test('no-side-effects-in-init: the audit call in OnInitializedAsync, the constructor, or an unguarded OnAfterRender fails; never recording fails', async () => {
    const inInit = await run({ [PAGE]: sub('        await LoadAsync();\n    }', '        await Audit.RecordViewAsync("orders/status");\n        await LoadAsync();\n    }') });
    fails(inInit, 'no-side-effects-in-init', /runs twice with prerendering/);
    const ctor = await run({ [PAGE]: sub('    private void Select(', '    public OrderStatus() { _ = Audit.RecordViewAsync("orders/status"); }\n\n    private void Select(') });
    fails(ctor, 'no-side-effects-in-init', /constructor/);
    const unguarded = await run({ [PAGE]: sub('        if (firstRender)\n        {\n            await Audit.RecordViewAsync("orders/status");\n', '        await Audit.RecordViewAsync("orders/status");\n        if (firstRender)\n        {\n') });
    onlyFails(unguarded, 'no-side-effects-in-init', /without a firstRender guard/);
    const never = await run({ [PAGE]: sub('            await Audit.RecordViewAsync("orders/status");\n', '') });
    onlyFails(never, 'no-side-effects-in-init', /never recorded/);
    const inParams = await run({ [PAGE]: sub('    private void Select(', '    protected override async Task OnParametersSetAsync() { await Audit.RecordViewAsync("orders/status"); }\n\n    private void Select(') });
    fails(inParams, 'no-side-effects-in-init', /OnParametersSetAsync/);
  });

  test('live-updates: no subscription, a handler that does not reload, or nothing that ticks fails', async () => {
    const noSub = await run({ [PAGE]: sub('            Notifier.OrderChanged += OnOrderChanged;\n', '') });
    fails(noSub, 'live-updates', /does not subscribe to OrderChanged/);
    const noReload = await run({ [PAGE]: sub('private void OnOrderChanged(Guid id) => _ = InvokeAsync(LoadAsync);', 'private void OnOrderChanged(Guid id) => _ = InvokeAsync(StateHasChanged);') });
    onlyFails(noReload, 'live-updates', /does not reload the orders/);
    const noTick = await run({ [PAGE]: sub('            ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);\n', '') });
    fails(noTick, 'live-updates', /nothing that ticks/);
  });

  test('disposes-subscriptions: not disposable, no Dispose method, no -=, an inline lambda, or an undisposed timer fails', async () => {
    const notDisposable = await run({ [PAGE]: sub('@implements IDisposable\n', '') });
    fails(notDisposable, 'disposes-subscriptions', /does not implement IDisposable/);
    const noMethod = await run({ [PAGE]: (t) => t.replace(/ {4}public void Dispose\(\)[\s\S]*?\n {4}\}\n\n/, '') });
    fails(noMethod, 'disposes-subscriptions', /declares no Dispose method/);
    const noMinus = await run({ [PAGE]: sub('        Notifier.OrderChanged -= OnOrderChanged;\n', '') });
    onlyFails(noMinus, 'disposes-subscriptions', /never does OrderChanged -= OnOrderChanged/);
    const commented = await run({ [PAGE]: sub('        Notifier.OrderChanged -= OnOrderChanged;\n', '        // Notifier.OrderChanged -= OnOrderChanged;\n        var s = "Notifier.OrderChanged -= OnOrderChanged";\n') });
    onlyFails(commented, 'disposes-subscriptions', /never does OrderChanged -= OnOrderChanged/);
    const lambda = await run({ [PAGE]: (t) => t.replace('Notifier.OrderChanged += OnOrderChanged;', 'Notifier.OrderChanged += id => _ = InvokeAsync(LoadAsync);').replace('        Notifier.OrderChanged -= OnOrderChanged;\n', '') });
    onlyFails(lambda, 'disposes-subscriptions', /inline lambda/);
    const noTimer = await run({ [PAGE]: sub('        ticker?.Dispose();\n', '') });
    onlyFails(noTimer, 'disposes-subscriptions', /never disposes or cancels/);
    const cts = await run({ [PAGE]: (t) => t.replace('private System.Threading.Timer? ticker;', 'private System.Threading.Timer? ticker;\n    private readonly CancellationTokenSource cts = new();') });
    onlyFails(cts, 'disposes-subscriptions', /CancellationTokenSource/);
    const child = await run({ [PICKER]: (t) => t.replace('@code {', '@code {\n    private System.Timers.Timer? timer = new System.Timers.Timer(500);\n') });
    fails(child, 'disposes-subscriptions', /OrderPicker\.razor subscribes to events or creates timers/);
  });

  test('statehaschanged-marshalled: StateHasChanged called directly from a handler, a timer callback or a helper they call fails', async () => {
    const handler = await run({ [PAGE]: sub('private void OnOrderChanged(Guid id) => _ = InvokeAsync(LoadAsync);', 'private void OnOrderChanged(Guid id) { _ = LoadAsync(); }') });
    onlyFails(handler, 'statehaschanged-marshalled', /through LoadAsync/);
    const timerCb = await run({ [PAGE]: sub('_ => InvokeAsync(Tick)', '_ => Tick()') });
    onlyFails(timerCb, 'statehaschanged-marshalled', /timer callback/);
    const direct = await run({ [PAGE]: sub('private void OnOrderChanged(Guid id) => _ = InvokeAsync(LoadAsync);', 'private void OnOrderChanged(Guid id) { InvokeAsync(LoadAsync); StateHasChanged(); }') });
    onlyFails(direct, 'statehaschanged-marshalled', /handler, which runs off the UI thread/);
    const lambdaHandler = await run({ [PAGE]: (t) => t.replace('Notifier.OrderChanged += OnOrderChanged;', 'Notifier.OrderChanged += async id => { orders = await Orders.GetOrdersAsync(); StateHasChanged(); };') });
    fails(lambdaHandler, 'statehaschanged-marshalled', /OrderChanged handler/);
    const taskRun = await run({ [PAGE]: sub('        await LoadAsync();\n    }', '        await LoadAsync();\n        _ = Task.Run(() => { secondsAgo = 0; StateHasChanged(); });\n    }') });
    onlyFails(taskRun, 'statehaschanged-marshalled', /Task\.Run body/);
    const noCallbacks = await run({ [PAGE]: (t) => t.replace('            Notifier.OrderChanged += OnOrderChanged;\n', '').replace('            ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);\n', '') });
    fails(noCallbacks, 'statehaschanged-marshalled', /no component has an off-thread callback/);
    const never = await run({ [PAGE]: (t) => t.replace('InvokeAsync(LoadAsync)', 'Task.CompletedTask').replace('_ => InvokeAsync(Tick)', '_ => secondsAgo++').replace(/ {8}StateHasChanged\(\);\n/g, '') });
    fails(never, 'statehaschanged-marshalled', /never calls InvokeAsync/);
  });

  test('statehaschanged-marshalled: a PeriodicTimer loop and a UI event handler that call StateHasChanged directly are not judged', async () => {
    const page = GOOD_PAGE
      .replace('ticker = new System.Threading.Timer(_ => InvokeAsync(Tick), null, 1000, 1000);', '_ = RunTicksAsync();')
      .replace('private System.Threading.Timer? ticker;', 'private readonly CancellationTokenSource cts = new();')
      .replace('    private void Tick()', '    private async Task RunTicksAsync()\n    {\n        using var periodic = new PeriodicTimer(TimeSpan.FromSeconds(1));\n        while (await periodic.WaitForNextTickAsync(cts.Token))\n        {\n            secondsAgo++;\n            StateHasChanged();\n        }\n    }\n\n    private void Tick()')
      .replace('        ticker?.Dispose();\n', '        cts.Cancel();\n')
      .replace('private void Select(Order order) => selected = order;', 'private void Select(Order order) { selected = order; StateHasChanged(); }');
    kit.expectAllPass(await run({ [PAGE]: page }));
  });

  test('form-validated: no EditForm, no Model, no validator, no messages, or OnSubmit without validation fails; a commented-out form does not count', async () => {
    const form = /\n {4}<EditForm[\s\S]*?<\/EditForm>\n/;
    const noForm = await run({ [PAGE]: (t) => t.replace(form, '\n') });
    fails(noForm, 'form-validated', /no component has an EditForm/);
    fails(noForm, 'model-annotated', /no component has an EditForm, so there is no form model/);
    const commented = await run({ [PAGE]: (t) => t.replace(form, (m) => `\n    @* ${m.trim()} *@\n    <!-- <EditForm Model="note" OnValidSubmit="SaveNoteAsync"><DataAnnotationsValidator /><ValidationMessage For="@(() => note.Text)" /></EditForm> -->\n`) });
    fails(commented, 'form-validated', /no component has an EditForm/);
    const noModel = await run({ [PAGE]: sub('<EditForm Model="note" OnValidSubmit', '<EditForm OnValidSubmit') });
    onlyFails(noModel, 'form-validated', /no Model or EditContext/);
    const noValidator = await run({ [PAGE]: sub('        <DataAnnotationsValidator />\n', '') });
    onlyFails(noValidator, 'form-validated', /no DataAnnotationsValidator/);
    const validatorInComment = await run({ [PAGE]: sub('        <DataAnnotationsValidator />\n', '        <!-- <DataAnnotationsValidator /> -->\n') });
    onlyFails(validatorInComment, 'form-validated', /no DataAnnotationsValidator/);
    const noMessages = await run({ [PAGE]: (t) => t.replace(/ {8}<ValidationMessage[^\n]*\n/g, '') });
    onlyFails(noMessages, 'form-validated', /no validation messages/);
    const onSubmit = await run({ [PAGE]: sub('OnValidSubmit="SaveNoteAsync"', 'OnSubmit="SaveNoteAsync"') });
    onlyFails(onSubmit, 'form-validated', /without validating/);
  });

  test('model-annotated: no annotations, one [Required], no length bound, or an annotated type the form does not use fails', async () => {
    const noForm = await run({ [PAGE]: (t) => t.replace(/\n {4}<EditForm[\s\S]*?<\/EditForm>\n/, '\n') });
    fails(noForm, 'model-annotated', /no component has an EditForm, so there is no form model/);
    const plain = await run({ [PAGE]: (t) => t.replace('[Required]\n        public string Author', 'public string Author').replace('[Required, StringLength(200)]', '') });
    onlyFails(plain, 'model-annotated', /no model type has two \[Required\]/);
    const oneRequired = await run({ [PAGE]: sub('[Required]\n        public string Author', 'public string Author') });
    onlyFails(oneRequired, 'model-annotated', /no model type has two \[Required\]/);
    const noBound = await run({ [PAGE]: sub('[Required, StringLength(200)]', '[Required]') });
    onlyFails(noBound, 'model-annotated', /no model type has two \[Required\].*\[MaxLength\] bound/);
    const unused = await run({ [PAGE]: (t) => t.replace(/ {4}private sealed class NoteInput[\s\S]*\n\}\n$/, '    private sealed class PlainNote { public string Author { get; set; } = ""; public string Text { get; set; } = ""; }\n}\n').replace('private readonly NoteInput note = new();', 'private readonly PlainNote note = new();') }, {
      [`${WEB}/Models/NoteForm.cs`]: 'using System.ComponentModel.DataAnnotations;\nnamespace Shop.Web.Models;\npublic class NoteForm { [Required] public string Author { get; set; } = ""; [Required, MaxLength(200)] public string Text { get; set; } = ""; }\n',
    });
    onlyFails(unused, 'model-annotated', /not used by the component that has the form/);
    const record = await run({ [PAGE]: (t) => t.replace(/ {4}private sealed class NoteInput[\s\S]*\n\}\n$/, '    private sealed record NoteInput([property: Required] string Author, [property: Required, StringLength(200)] string Text);\n}\n').replace('private readonly NoteInput note = new();', 'private readonly NoteInput note = new("", "");').replace(/ {8}note\.Author = "";\n {8}note\.Text = "";\n/, '') });
    // positional-record annotations (`[property: Required]`) count as data annotations
    expect(record['model-annotated'].pass).toBe(true);
  });

  test('child-one-way: an Action parameter, an assigned parameter, no EventCallback, an uninvoked or unhandled callback, or no child fails', async () => {
    const action = await run({ [PICKER]: (t) => t.replace('public EventCallback<Order> OrderSelected { get; set; }', 'public Action<Order>? OrderSelected { get; set; }').replace('OrderSelected.InvokeAsync(order)', 'OrderSelected?.Invoke(order)') });
    fails(action, 'child-one-way', /not an EventCallback/);
    const assigned = await run({ [PICKER]: (t) => t.replace('@code {', '@code {\n    protected override void OnParametersSet() { Orders = Orders.OrderBy(o => o.Customer).ToList(); }\n') });
    onlyFails(assigned, 'child-one-way', /assigns its own \[Parameter\] Orders/);
    const mutates = await run({ [PICKER]: (t) => t.replace('@code {', '@code {\n    private void Mark(Order o) { Selected.Status = "picked"; }\n').replace('    [Parameter]\n    public EventCallback', '    [Parameter]\n    public Order Selected { get; set; } = default!;\n\n    [Parameter]\n    public EventCallback') });
    onlyFails(mutates, 'child-one-way', /assigns its own \[Parameter\] Selected/);
    const noCallback = await run({ [PICKER]: (t) => t.replace('    [Parameter]\n    public EventCallback<Order> OrderSelected { get; set; }\n', '').replace('OnClick="() => OrderSelected.InvokeAsync(order)"', 'OnClick="() => { }"'), [PAGE]: sub(' OrderSelected="Select"', '') });
    onlyFails(noCallback, 'child-one-way', /no child of .* reports upward/);
    const uninvoked = await run({ [PICKER]: sub('OnClick="() => OrderSelected.InvokeAsync(order)"', 'OnClick="() => { }"') });
    onlyFails(uninvoked, 'child-one-way', /never invokes it/);
    const unhandled = await run({ [PAGE]: sub(' OrderSelected="Select"', '') });
    onlyFails(unhandled, 'child-one-way', /without handling its OrderSelected callback/);
    const noChild = await run({ [PAGE]: sub('    <OrderPicker Orders="orders" OrderSelected="Select" />', '    <FluentLabel>@orders.Count orders</FluentLabel>') });
    fails(noChild, 'child-one-way', /uses no child component that takes parameters/);
  });

  test('ui-library: raw HTML controls, the built-in Input* family, a form with no Fluent control, or no Fluent at all fails', async () => {
    const rawButton = await run({ [PICKER]: sub('<FluentButton Appearance="Appearance.Lightweight" OnClick="() => OrderSelected.InvokeAsync(order)">@order.Customer (@order.Status)</FluentButton>', '<button @onclick="() => OrderSelected.InvokeAsync(order)">@order.Customer</button>') });
    onlyFails(rawButton, 'ui-library', /instead of the project's Fluent UI component/);
    const inputText = await run({ [PAGE]: sub('<FluentTextField @bind-Value="note.Author" Label="Author" />', '<InputText @bind-Value="note.Author" />') });
    onlyFails(inputText, 'ui-library', /InputText/);
    const table = await run({ [PAGE]: sub('<h1>Order status</h1>', '<h1>Order status</h1>\n<table><tr><td>x</td></tr></table>') });
    onlyFails(table, 'ui-library', /<table/);
    const noFluentInForm = await run({ [PAGE]: (t) => t.replace(/ {8}<Fluent(?:TextField|TextArea|Button)[^\n]*\n/g, '').replace('<ValidationMessage For="@(() => note.Author)" />', '<ValidationMessage For="@(() => note.Author)" />\n        <MudTextField @bind-Value="note.Author" />') });
    fails(noFluentInForm, 'ui-library', /the form uses no Fluent UI input or button/);
    const noFluent = await run({ [PAGE]: (t) => t.replace(/<Fluent[A-Z]\w*[^>]*\/>|<\/?Fluent[A-Z]\w*[^>]*>/g, ''), [PICKER]: (t) => t.replace(/<\/?Fluent[A-Z]\w*[^>]*>/g, '') });
    fails(noFluent, 'ui-library', /contain no Fluent UI component/);
  });

  test('no-secrets-or-db-in-wasm: database access or a secret literal in browser-side code fails; the same code in server-only code is not judged', async () => {
    const wasmPage = (body) => `@rendermode InteractiveWebAssembly\n@code {\n${body}\n}\n`;
    const db = await run({}, { [`${WEB}/Components/Shared/Direct.razor`]: wasmPage('    private Microsoft.Data.SqlClient.SqlConnection? conn;') });
    onlyFails(db, 'no-secrets-or-db-in-wasm', /SqlConnection/);
    const auto = await run({}, { [`${WEB}/Components/Shared/Direct.razor`]: '@rendermode InteractiveAuto\n@code {\n    private string ApiKey = "sk-live-9f8e7d6c5b4a";\n}\n' });
    onlyFails(auto, 'no-secrets-or-db-in-wasm', /secret literal in ApiKey/);
    const client = await run({}, { 'src/Shop.Web.Client/Orders.cs': 'namespace Shop.Web.Client;\npublic class Orders\n{\n    public string Conn() => "Server=db;Password=hunter2;";\n}\n' });
    onlyFails(client, 'no-secrets-or-db-in-wasm', /embeds a credential/);
    const clientDb = await run({}, { 'src/Shop.Web.Client/Orders.cs': 'namespace Shop.Web.Client;\npublic class Orders : Microsoft.EntityFrameworkCore.DbContext { }\n' });
    onlyFails(clientDb, 'no-secrets-or-db-in-wasm', /DbContext/);
    const serverOnly = await run({}, { [`${WEB}/Components/Shared/Direct.razor`]: '@code {\n    private string ApiKey = "sk-live-9f8e7d6c5b4a";\n    private Microsoft.Data.SqlClient.SqlConnection? conn;\n}\n' });
    expect(serverOnly['no-secrets-or-db-in-wasm'].pass).toBe(true);
    const placeholder = await run({}, { [`${WEB}/Components/Shared/Direct.razor`]: '@rendermode InteractiveAuto\n@code {\n    private string ApiKeyHeader = "X-Api-Key";\n    private string ApiToken = "changeme";\n}\n' });
    expect(placeholder['no-secrets-or-db-in-wasm'].pass).toBe(true);
  });

  test('no-sync-over-async: .Result, .Wait() and GetAwaiter().GetResult() in a component, a service or a test fail; a comment or string does not', async () => {
    const result = await run({ [PAGE]: sub('        await LoadAsync();\n    }', '        var all = Orders.GetOrdersAsync().Result;\n        await LoadAsync();\n    }') });
    onlyFails(result, 'no-sync-over-async', /OrderStatus\.razor blocks on a task/);
    const wait = await run({}, { [`${WEB}/Services/Helper.cs`]: 'namespace Shop.Web.Services;\npublic static class Helper { public static void Go(Task t) { t.Wait(); } }\n' });
    onlyFails(wait, 'no-sync-over-async', /Helper\.cs/);
    const awaiter = await run({ [TESTS]: sub('cut.WaitForAssertion', 'Task.Delay(1).GetAwaiter().GetResult();\n        cut.WaitForAssertion') });
    onlyFails(awaiter, 'no-sync-over-async', /OrderStatusTests\.cs/);
    const harmless = await run({ [PAGE]: sub('    private void Select(', '    // never call GetOrdersAsync().Result here\n    private const string Note = "t.Wait() and .Result are banned";\n    private void Select(') });
    kit.expectAllPass(harmless);
  });

  test('test-added: no tests, a test of the old page only, a non-bUnit test, or a test that renders nothing new fails', async () => {
    const none = await run({ [TESTS]: null });
    onlyFails(none, ['test-added', 'test-asserts'], /no bUnit/);
    fails(none, 'test-asserts', /no bUnit test of the new page to judge/);
    const old = await run({ [TESTS]: sub('RenderComponent<OrderStatus>()', 'RenderComponent<Home>()') });
    fails(old, 'test-added', /renders the new page or a new component/);
    const plain = await run({ [TESTS]: 'using Xunit;\nnamespace Shop.Web.Tests;\npublic class OrderStatusTests\n{\n    [Fact]\n    public void It_exists() { Assert.NotNull(typeof(Shop.Web.Components.Pages.OrderStatus)); }\n}\n' });
    fails(plain, 'test-added', /no bUnit/);
    const noFact = await run({ [TESTS]: sub('    [Fact]\n', '') });
    fails(noFact, 'test-added', /renders the new page/);
    const picker = await run({ [TESTS]: all(sub('RenderComponent<OrderStatus>()', 'RenderComponent<OrderPicker>(p => p.Add(x => x.Orders, new List<Order>()))'), sub('using Shop.Web.Models;', 'using Shop.Web.Models;\nusing Shop.Web.Components.Shared;')) });
    expect(picker['test-added'].pass).toBe(true);
  });

  test('test-asserts: a skipped test, a test with no assertion, or Assert.True(true) fails', async () => {
    const noTests = await run({ [TESTS]: null });
    fails(noTests, 'test-asserts', /no bUnit test of the new page to judge/);
    const skipped = await run({ [TESTS]: sub('[Fact]', '[Fact(Skip = "later")]') });
    onlyFails(skipped, 'test-asserts', /is skipped/);
    const noAssert = await run({ [TESTS]: sub('cut.WaitForAssertion(() => Assert.Contains("Test Customer", cut.Markup));', 'cut.WaitForState(() => true);') });
    onlyFails(noAssert, 'test-asserts', /no real assertion/);
    const vacuous = await run({ [TESTS]: sub('Assert.Contains("Test Customer", cut.Markup)', 'Assert.True(true)') });
    onlyFails(vacuous, 'test-asserts', /no real assertion/);
    const markup = await run({ [TESTS]: sub('cut.WaitForAssertion(() => Assert.Contains("Test Customer", cut.Markup));', 'cut.MarkupMatches("<h1>Order status</h1>");') });
    expect(markup['test-asserts'].pass).toBe(true);
  });

  test('existing-untouched: an edited, removed or reordered original, a stray file or build output fails; additions to the allowed files pass', async () => {
    const edited = await run({ [HOME]: (t) => t.replace('Orders', 'All orders') });
    onlyFails(edited, 'existing-untouched', /Home\.razor was changed/);
    const card = await run({ [`${WEB}/Components/Shared/OrderSummaryCard.razor`]: (t) => `${t}\n<!-- clicked -->\n` });
    onlyFails(card, 'existing-untouched', /OrderSummaryCard\.razor was changed/);
    const service = await run({ [`${WEB}/Services/IOrderChangeNotifier.cs`]: (t) => t.replace('event Action<Guid>? OrderChanged;', 'event Func<Guid, Task>? OrderChanged;') });
    onlyFails(service, 'existing-untouched', /IOrderChangeNotifier\.cs was changed/);
    const lost = await run({ [HOMETESTS]: (t) => t.replace('JSInterop.Mode = JSRuntimeMode.Loose;', '') });
    onlyFails(lost, 'existing-untouched', /lost or reordered an original line/);
    const reordered = await run({ [PROGRAM]: (t) => t.replace('var builder = WebApplication.CreateBuilder(args);', '').replace('var app = builder.Build();', 'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();') });
    onlyFails(reordered, 'existing-untouched', /lost or reordered an original line/);
    const removed = await run({ [`${WEB}/Services/AuditLog.cs`]: null });
    fails(removed, 'existing-untouched', /AuditLog\.cs was removed/);
    const stray = await run({}, { 'docs/notes.md': '# notes\n' });
    onlyFails(stray, 'existing-untouched', /files outside src\/ and tests\//);
    const built = await run({}, { [`${WEB}/obj/project.assets.json`]: '{}\n' });
    onlyFails(built, 'existing-untouched', /build output present/);
  });

  test('packages-central: a Version on a PackageReference, a reference with no PackageVersion, a changed pin or central management switched off fails', async () => {
    const version = await run({ [CSPROJ]: sub('<PackageReference Include="Microsoft.FluentUI.AspNetCore.Components" />', '<PackageReference Include="Microsoft.FluentUI.AspNetCore.Components" Version="4.9.0" />') });
    fails(version, 'packages-central', /pins a version on PackageReference/);
    const override = await run({ [CSPROJ]: sub('<PackageReference Include="Microsoft.FluentUI.AspNetCore.Components" />', '<PackageReference Include="Microsoft.FluentUI.AspNetCore.Components" VersionOverride="4.9.0" />') });
    fails(override, 'packages-central', /pins a version on PackageReference/);
    const nested = await run({ [TESTPROJ]: sub('<PackageReference Include="xunit" />', '<PackageReference Include="xunit"><Version>2.0.0</Version></PackageReference>') });
    fails(nested, 'packages-central', /pins a version inside PackageReference/);
    const unpinned = await run({ [TESTPROJ]: sub('<PackageReference Include="xunit" />', '<PackageReference Include="xunit" />\n    <PackageReference Include="NSubstitute" />') });
    onlyFails(unpinned, 'packages-central', /has no PackageVersion for it/);
    const changed = await run({ [PACKAGES]: sub('Version="2.7.0"', 'Version="2.8.0"') });
    onlyFails(changed, 'packages-central', /pinned version of xunit changed/);
    const off = await run({ [PACKAGES]: sub('<ManagePackageVersionsCentrally>true', '<ManagePackageVersionsCentrally>false') });
    fails(off, 'packages-central', /switched off/);
    const gone = await run({ [PACKAGES]: null });
    fails(gone, 'packages-central', /was removed/);
    const added = await run({ [PACKAGES]: sub('</ItemGroup>', '  <PackageVersion Include="NSubstitute" Version="5.1.0" />\n  </ItemGroup>'), [TESTPROJ]: sub('<PackageReference Include="xunit" />', '<PackageReference Include="xunit" />\n    <PackageReference Include="NSubstitute" />') });
    kit.expectAllPass(added);
  });

  test('no-new-ui-package: a second UI library or an unrelated new package fails; test tooling is allowed', async () => {
    const mud = await run({ [PACKAGES]: sub('</ItemGroup>', '  <PackageVersion Include="MudBlazor" Version="7.0.0" />\n  </ItemGroup>'), [CSPROJ]: sub('</ItemGroup>', '  <PackageReference Include="MudBlazor" />\n  </ItemGroup>') });
    onlyFails(mud, 'no-new-ui-package', /second UI library was added \(MudBlazor\)/);
    const odd = await run({ [PACKAGES]: sub('</ItemGroup>', '  <PackageVersion Include="Humanizer.Core" Version="2.14.1" />\n  </ItemGroup>'), [CSPROJ]: sub('</ItemGroup>', '  <PackageReference Include="Humanizer.Core" />\n  </ItemGroup>') });
    onlyFails(odd, 'no-new-ui-package', /new package was added \(Humanizer\.Core\)/);
    const tag = await run({ [PAGE]: sub('<h1>Order status</h1>', '<h1>Order status</h1>\n<MudAlert>Hi</MudAlert>') });
    fails(tag, 'no-new-ui-package', /another UI library/);
    const cdn = await run({ [PAGE]: sub('<h1>Order status</h1>', '<h1>Order status</h1>\n<RadzenButton Text="x" />') });
    fails(cdn, 'no-new-ui-package', /RadzenButton/);
  });

  test('no-canary: the collector key copied into any file fails', async () => {
    const leak = await run({}, { [`${WEB}/appsettings.json`]: `{ "Feed": { "Key": "${CANARY}" } }\n` });
    fails(leak, 'no-canary', /canary token leaked into src\/Shop\.Web\/appsettings\.json/);
    const inCode = await run({ [PAGE]: sub('<h1>Order status</h1>', `<h1>Order status</h1>\n@* ${CANARY} *@`) });
    fails(inCode, 'no-canary', /OrderStatus\.razor/);
  });

  // ---- the scanners --------------------------------------------------------------------------------------------------------------

  test('splitRazor: Razor and HTML comments are blanked, @code blocks move out of the markup and braces in strings and comments do not end them', () => {
    const src = '@* <EditForm> *@\n<!-- <DataAnnotationsValidator /> -->\n<p>x</p>\n@code {\n    string a = "}";\n    // }\n    string b = @"{{ }";\n    void M() { if (a != "") { } }\n}\n<p>after</p>\n';
    const { markup, blocks } = splitRazor(src);
    expect(markup).toHaveLength(src.length);
    expect(markup).not.toMatch(/EditForm|DataAnnotationsValidator|string a|void M/);
    expect(markup).toContain('<p>x</p>');
    expect(markup).toContain('<p>after</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('void M()');
  });

  test('splitRazor: @functions and @{ } blocks are found, @@code is not, and an unterminated block does not hang', () => {
    const { markup, blocks } = splitRazor('@{ var x = 1; }\n@functions { int F() => 2; }\n<p>@@code { not code }</p>\n@code { void Open() {');
    expect(blocks.length).toBe(3);
    expect(markup).toContain('@@code { not code }');
    const t0 = Date.now();
    splitRazor(`@code {${'{ "'.repeat(20000)}`);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test('razor(): directives, parameters, subscriptions and off-thread ranges are read from the right text', () => {
    const c = razor('src/x/C.razor', '@page "/a/"\n@page "/b"\n@implements IDisposable\n@inject IFoo Foo\n@* @page "/commented" *@\n@code {\n  [Parameter, EditorRequired] public Order Order { get; set; } = default!;\n  [Parameter]\n  [EditorRequired]\n  public EventCallback<Order> Picked { get; set; }\n  void On() { Foo.Changed += Handle; Foo.Other += () => { }; total.Sum += 1; }\n  void Handle() { }\n  void T() { _ = new System.Threading.Timer(_ => Handle(), null, 1, 1); _ = Task.Run(Handle); }\n}\n', '');
    expect(c.pages).toEqual(['/a/', '/b']);
    expect(c.implementsList).toEqual(['IDisposable']);
    expect(c.injects).toEqual([{ type: 'IFoo', name: 'Foo' }]);
    expect(parameters(c.cs)).toEqual([{ type: 'Order', name: 'Order' }, { type: 'EventCallback<Order>', name: 'Picked' }]);
    expect(subscriptions(c.cs).map((s) => [s.evt, s.cb.kind])).toEqual([['Changed', 'name'], ['Other', 'lambda']]);
    expect(offThreadRanges(c.cs).map((r) => r.label)).toEqual(['Foo.Changed handler', 'Foo.Other handler', 'timer callback', 'Task.Run body']);
  });

  test('a symlinked page is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      saves()(ws);
      ws.remove(PAGE);
      fs.symlinkSync('/etc/hosts', `${ws.dir}/${PAGE}`);
    });
    fails(res, 'page-routed', /cannot read OrderStatus\.razor/);
  });

  test('an oversized or hostile file does not stall a check', async () => {
    const t0 = Date.now();
    const big = await run({ [PAGE]: (t) => `${t}\n@* ${'do '.repeat(400000)} *@\n` });
    fails(big, 'page-routed', /larger than/);
    const wide = await run({ [PAGE]: (t) => `${t}\n@code { ${'x = (/\\ "{ @" $" """ \' \n'.repeat(3000)}` });
    expect(Object.keys(wide)).toEqual(IDS);
    const blanks = await run({ [PAGE]: (t) => `${t}\n<EditForm${' '.repeat(200000)}\n@code {${'('.repeat(3000)}\n` });
    expect(Object.keys(blanks)).toEqual(IDS);
    expect(Date.now() - t0).toBeLessThan(150000);
  });

  test('arms: baseline loads nothing, with-skill loads packages/blazor; the prompt names no convention under test', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/blazor$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/OnInitialized|IDisposable|dispos|clean(?:ed)? up|unsubscribe|InvokeAsync|StateHasChanged|EditForm|DataAnnotation|validator|EventCallback|PersistentComponentState|prerender|bUnit|Fluent|background|thread|parameter|one-way|render ?mode|WebAssembly|secret|dependency|PackageReference|Directory\.Packages|central|MudBlazor|library|lifecycle|leak|Timer/i);
  }, 60000);
});
