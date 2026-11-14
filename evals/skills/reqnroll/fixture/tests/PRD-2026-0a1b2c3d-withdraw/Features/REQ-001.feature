@prd-2026-0a1b2c3d @REQ-001
Feature: Withdraw cash (Must)
  # Label: prd-withdraw
  # Priority: Must

  @AC-001-1 @hash:0806ffc841a6
  Scenario: AC-001-1
    Given an open account with a balance of 100
    When the owner withdraws 30
    Then the balance is 70

  @AC-001-2 @hash:0dd91dff0284
  Scenario: AC-001-2
    Given an open account with a balance of 20
    When the owner withdraws 50
    Then the account is still open!

  @AC-001-3 @hash:346d789bea1a
  Scenario: AC-001-3
    Given an open account with a balance of 50
    When the owner withdraws 50
    Then the account is still open?
