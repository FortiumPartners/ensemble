---
name: blazor
description: Use when building Blazor Server/WebAssembly/Web App components on .NET 8+ (.razor files, render modes, forms); not for ASP.NET Core APIs or Wolverine/Marten backends (see dotnet).
metadata:
  version: 2.0.0
---

# Blazor conventions

Check the target framework and the hosting model in `Program.cs` first; render modes (`InteractiveServer`, `InteractiveWebAssembly`, `InteractiveAuto`) change what code may run where.

Gotchas:
- Do component-level data loading in `OnInitializedAsync`; it runs twice with prerendering, so avoid side effects or persist state with `PersistentComponentState`.
- Dispose subscriptions/timers via `IDisposable`/`IAsyncDisposable`; Blazor Server circuits leak otherwise.
- WebAssembly code runs in the browser: no secrets, no direct DB access; call an API.
- Call `StateHasChanged` via `InvokeAsync` when updating from non-UI threads.
- Use `EditForm` with `DataAnnotationsValidator`; keep parameters one-way and use `EventCallback` upward.
- Prefer the UI library already in the project (e.g. Fluent UI Blazor).
- Component tests: bUnit. BDD acceptance tests follow the `reqnroll` skill.
