using Reqnroll;
using FluentAssertions;

namespace Acceptance.Tests;

// Auto-generated step bindings for REQ-001: Convert a CSV file to a JSON array (Must)
// Attributes are GENERATED and authoritative — do not edit them.
// Fill the method bodies (replace PendingStepException) test-first.
[Binding]
public partial class REQ001Steps
{
    private readonly ScenarioContext _ctx;
    public REQ001Steps(ScenarioContext ctx) => _ctx = ctx;

    [Given(@"^a CSV file with a header row$")]
    public void GivenACSVFileWithAHeaderRow() => throw new PendingStepException();

    [When(@"^the analyst runs `csv2json data\.csv`$")]
    public void WhenTheAnalystRunsCsv2jsonDataCsv() => throw new PendingStepException();

    [Then(@"^the tool prints a JSON array with one object per data row$")]
    public void ThenTheToolPrintsAJSONArrayWithOneObjectPerDataRow() => throw new PendingStepException();

    [Given(@"^an empty CSV file$")]
    public void GivenAnEmptyCSVFile() => throw new PendingStepException();

    [When(@"^the analyst runs `csv2json empty\.csv`$")]
    public void WhenTheAnalystRunsCsv2jsonEmptyCsv() => throw new PendingStepException();

    [Then(@"^the tool prints an empty array$")]
    public void ThenTheToolPrintsAnEmptyArray() => throw new PendingStepException();
}
