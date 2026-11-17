@prd-2026-b7c8d9e0 @REQ-001
Feature: Convert a CSV file to a JSON array (Must)
  # Label: prd-csv2json
  # Priority: Must

  @AC-001-1 @hash:60272d24fe24
  Scenario: AC-001-1
    Given a CSV file with a header row
    When the analyst runs `csv2json data.csv`
    Then the tool prints a JSON array with one object per data row

  @AC-001-2 @hash:5eb83f381a1e
  Scenario: AC-001-2
    Given an empty CSV file
    When the analyst runs `csv2json empty.csv`
    Then the tool prints an empty array
