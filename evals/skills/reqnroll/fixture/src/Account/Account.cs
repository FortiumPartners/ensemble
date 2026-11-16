namespace Acme.Accounts;

// A small in-memory decider: Decide turns a command into events, Evolve folds an event into the state. No I/O.
public abstract record AccountCommand;
public sealed record Withdraw(decimal Amount) : AccountCommand;

public abstract record AccountEvent;
public sealed record AccountOpened(string Owner, decimal Balance) : AccountEvent;
public sealed record MoneyWithdrawn(decimal Amount) : AccountEvent;
public sealed record WithdrawalRejected(string Reason) : AccountEvent;

public sealed record AccountState(bool Open, decimal Balance);

public static class Account
{
    public static readonly AccountState Initial = new(false, 0m);

    public static IReadOnlyList<AccountEvent> Decide(AccountCommand command, AccountState state)
    {
        switch (command)
        {
            case Withdraw w when !state.Open:
                return new AccountEvent[] { new WithdrawalRejected("account is not open") };
            case Withdraw w when w.Amount <= 0m:
                return new AccountEvent[] { new WithdrawalRejected("amount must be positive") };
            case Withdraw w when w.Amount > state.Balance:
                return new AccountEvent[] { new WithdrawalRejected("insufficient funds") };
            case Withdraw w:
                return new AccountEvent[] { new MoneyWithdrawn(w.Amount) };
            default:
                throw new ArgumentOutOfRangeException(nameof(command));
        }
    }

    public static AccountState Evolve(AccountState state, AccountEvent @event) => @event switch
    {
        AccountOpened e => new AccountState(true, e.Balance),
        MoneyWithdrawn e => state with { Balance = state.Balance - e.Amount },
        WithdrawalRejected => state,
        _ => throw new ArgumentOutOfRangeException(nameof(@event)),
    };
}
