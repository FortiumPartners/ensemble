@prd-2026-b7c8d9e0 @REQ-002
Feature: Report malformed input (Must)
  # Label: prd-csv2json
  # Priority: Must

  @AC-002-1 @hash:b07a7d78f120
  Scenario: AC-002-1
    Given a CSV row with more fields than the header
    When the analyst runs the tool
    Then it exits non-zero and names the row number
