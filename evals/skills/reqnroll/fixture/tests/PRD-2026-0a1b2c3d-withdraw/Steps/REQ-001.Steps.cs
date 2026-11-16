using Reqnroll;
using FluentAssertions;

namespace Acceptance.Tests;

// Auto-generated step bindings for REQ-001: Withdraw cash (Must)
// Attributes are GENERATED and authoritative — do not edit them.
// Fill the method bodies (replace PendingStepException) test-first.
[Binding]
public partial class REQ001Steps
{
    private readonly ScenarioContext _ctx;
    public REQ001Steps(ScenarioContext ctx) => _ctx = ctx;

    [Given(@"^an open account with a balance of 100$")]
    public void GivenAnOpenAccountWithABalanceOf100() => throw new PendingStepException();

    [When(@"^the owner withdraws 30$")]
    public void WhenTheOwnerWithdraws30() => throw new PendingStepException();

    [Then(@"^the balance is 70$")]
    public void ThenTheBalanceIs70() => throw new PendingStepException();

    [Given(@"^an open account with a balance of 20$")]
    public void GivenAnOpenAccountWithABalanceOf20() => throw new PendingStepException();

    [When(@"^the owner withdraws 50$")]
    public void WhenTheOwnerWithdraws50() => throw new PendingStepException();

    [Then(@"^the account is still open!$")]
    public void ThenTheAccountIsStillOpen_af21b4171b17() => throw new PendingStepException();

    [Given(@"^an open account with a balance of 50$")]
    public void GivenAnOpenAccountWithABalanceOf50() => throw new PendingStepException();

    [Then(@"^the account is still open\?$")]
    public void ThenTheAccountIsStillOpen_a8b327db63b5() => throw new PendingStepException();
}
