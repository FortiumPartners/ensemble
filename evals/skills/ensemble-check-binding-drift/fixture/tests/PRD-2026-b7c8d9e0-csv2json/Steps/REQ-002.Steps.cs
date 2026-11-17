using Reqnroll;
using FluentAssertions;

namespace Acceptance.Tests;

// Auto-generated step bindings for REQ-002: Report malformed input (Must)
// Attributes are GENERATED and authoritative — do not edit them.
// Fill the method bodies (replace PendingStepException) test-first.
[Binding]
public partial class REQ002Steps
{
    private readonly ScenarioContext _ctx;
    public REQ002Steps(ScenarioContext ctx) => _ctx = ctx;

    [Given(@"^a CSV row with more fields than the header$")]
    public void GivenACSVRowWithMoreFieldsThanTheHeader() => throw new PendingStepException();

    [When(@"^the analyst runs the tool$")]
    public void WhenTheAnalystRunsTheTool() => throw new PendingStepException();

    [Then(@"^it exits non-zero and names the row number$")]
    public void ThenItExitsNonZeroAndNamesTheRowNumber() => throw new PendingStepException();
}
