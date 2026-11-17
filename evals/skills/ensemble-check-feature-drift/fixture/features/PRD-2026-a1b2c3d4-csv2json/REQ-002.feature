@prd-2026-a1b2c3d4 @REQ-002
Feature: Report malformed input (Must)
  # Label: prd-csv2json
  # Priority: Must

  @AC-002-1 @hash:b07a7d78f120
  Scenario: AC-002-1
    Given a CSV row with more fields than the header
    When the analyst runs the tool
    Then it exits non-zero and names the row number

  @AC-002-2 @hash:3d954850e536
  Scenario: AC-002-2
    Given a CSV file that cannot be read
    When the analyst runs the tool
    Then it exits non-zero and names the file
