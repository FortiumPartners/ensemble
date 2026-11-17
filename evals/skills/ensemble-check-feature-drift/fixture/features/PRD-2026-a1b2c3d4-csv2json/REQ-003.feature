@prd-2026-a1b2c3d4 @REQ-003
Feature: Choose the delimiter (Should)
  # Label: prd-csv2json
  # Priority: Should

  @AC-003-1 @hash:6471e7b038d6
  Scenario: AC-003-1
    Given a semicolon-separated file
    When the analyst passes the delimiter option
    Then the rows are split on semicolons
