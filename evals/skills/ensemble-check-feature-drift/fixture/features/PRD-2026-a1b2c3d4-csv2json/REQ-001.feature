@prd-2026-a1b2c3d4 @REQ-001
Feature: Convert a CSV file to a JSON array (Must)
  # Label: prd-csv2json
  # Priority: Must

  @AC-001-1 @hash:60272d24fe24
  Scenario: AC-001-1
    Given a CSV file with a header row
    When the analyst runs `csv2json data.csv`
    Then the tool prints a JSON array with one object per data row

  @AC-001-2 @hash:54858e8aeae3
  Scenario: AC-001-2
    Given an empty CSV file
    When the analyst runs `csv2json empty.csv`
    Then the tool prints `[]`

  @AC-001-3 @hash:152613d536d5
  Scenario: AC-001-3
    Given a CSV file with quoted fields
    When the analyst runs the tool
    Then commas inside quotes stay in the field
