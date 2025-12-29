#!/usr/bin/env python3
"""
Tests for the UserPromptSubmit Router Hook (scenario-based version with project rules).

Run with: python -m pytest tests/test_router.py -v
"""

import json
import os
import sys
import tempfile
from unittest import mock

import pytest

# Add hooks directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'hooks'))

from router import (
    RouterConfig,
    MatchResult,
    Scenario,
    load_config,
    read_input,
    write_output,
    load_rules_file,
    load_global_rules,
    load_project_rules,
    merge_rules,
    validate_rules,
    normalize_text,
    count_words,
    match_agent_categories,
    match_skills,
    analyze_prompt,
    determine_scenario,
    build_short_no_match_hint,
    build_long_no_match_hint,
    build_agents_only_hint,
    build_skills_only_hint,
    build_agents_and_skills_hint,
    build_hint,
    build_output,
)


# === Test Fixtures ===
@pytest.fixture
def sample_rules():
    """Return sample routing rules for testing."""
    return {
        "version": "1.0.0",
        "agent_categories": {
            "development": {
                "description": "Code implementation",
                "triggers": ["implement", "code", "build", "create feature", "frontend", "backend"],
                "agents": [
                    {"name": "frontend-developer", "purpose": "UI development", "tools": ["Read", "Write"]},
                    {"name": "backend-developer", "purpose": "Server-side logic", "tools": ["Read", "Write"]},
                ]
            },
            "quality_testing": {
                "description": "Testing and review",
                "triggers": ["test", "review", "debug", "fix bug"],
                "agents": [
                    {"name": "test-runner", "purpose": "Run tests", "tools": ["Bash"]},
                    {"name": "code-reviewer", "purpose": "Review code", "tools": ["Read"]},
                ]
            },
        },
        "skills": {
            "jest": {
                "triggers": ["jest", "javascript test", "typescript test"],
                "patterns": ["run.*jest", "jest.*test"],
                "purpose": "Jest testing"
            },
            "vercel": {
                "triggers": ["vercel", "nextjs", "next.js"],
                "patterns": ["deploy.*vercel", "vercel.*issue", "vercel.*problem"],
                "purpose": "Vercel deployments"
            },
        },
        "injection_templates": {
            "short_no_match": {
                "description": "Short prompts with no matches",
                "template": "You are an orchestrator, not an implementer. If this request involves any implementation (code, commands, file changes), delegate to an appropriate subagent. Only respond directly if this is: (1) a clarifying question, (2) a direct factual question, or (3) acknowledgment/conversation."
            },
            "agents_only": {
                "description": "When agents match but no skills",
                "template": "You MUST delegate to one of these subagents:\n{agent_list}\n\nYou are an orchestrator - implementation belongs in subagents, not this session. The ONLY exceptions: (1) answering a direct question about concepts, (2) reading files to provide information, (3) pure conversation. If the task involves ANY implementation, commands, or file changes - delegate."
            },
            "agents_and_skills": {
                "description": "When both agents and skills match",
                "template": "You MUST delegate to one of these subagents:\n{agent_list}\n\nPass these skills in the Task prompt: {skill_list}\n\nYou are an orchestrator - all implementation belongs in subagents. Do NOT execute commands, write code, or modify files directly."
            },
            "skills_only": {
                "description": "When skills match but no agents",
                "template": "Use these specialized skill(s): {skill_list}\n\nInvoke directly or pass to a subagent. These skills exist because the task requires specialized handling."
            },
            "long_no_match": {
                "description": "Longer prompts with no matches",
                "template": "You are an orchestrator. If this request involves implementation (code, commands, file changes), delegate to an appropriate subagent. Respond directly only for: questions, information lookup, or conversation."
            },
            "project_agents_only": {
                "description": "Project-specific agents matched - NO ESCAPE HATCH",
                "template": "MANDATORY DELEGATION. These subagents are configured for this project:\n{agent_list}\n\nProject-specific matches indicate this task requires specialist handling. You MUST delegate - no exceptions."
            },
            "project_skills_only": {
                "description": "Project-specific skills matched - NO ESCAPE HATCH",
                "template": "MANDATORY: Use these project-configured skill(s): {skill_list}\n\nThese skills exist because the project requires specific tooling. You MUST use them."
            },
            "project_agents_and_skills": {
                "description": "Project-specific agents and skills matched - NO ESCAPE HATCH",
                "template": "MANDATORY DELEGATION WITH PROJECT SKILLS.\n\nDelegate to one of these subagents:\n{agent_list}\n\nPass these project skills in the Task prompt: {skill_list}\n\nProject-specific matches are NOT optional."
            },
        },
    }


@pytest.fixture
def sample_project_rules():
    """Return sample project-specific routing rules."""
    return {
        "version": "1.0.0",
        "project_name": "test-project",
        "triggers": {
            "development": ["nextjs", "react"],
        },
        "skill_mappings": {
            "nextjs": ["vercel", "jest"],
        },
        "project_context": {
            "primary_language": "TypeScript",
            "framework": "Next.js",
        }
    }


@pytest.fixture
def config():
    """Return a test configuration."""
    return RouterConfig(
        rules_path="./router-rules.json",
        debug=False,
        short_threshold=5,
        cwd="/test/project",
    )


@pytest.fixture
def debug_config():
    """Return a test configuration with debug enabled."""
    return RouterConfig(
        rules_path="./router-rules.json",
        debug=True,
        short_threshold=5,
        cwd="/test/project",
    )


# === Configuration Tests ===
class TestLoadConfig:
    """Tests for load_config function."""

    def test_default_values(self):
        """Test default configuration values."""
        with mock.patch.dict(os.environ, {}, clear=True):
            config = load_config()
            # Default path is now relative to script location: ../lib/router-rules.json
            assert config.rules_path.endswith("lib/router-rules.json")
            assert config.debug is False
            assert config.short_threshold == 5

    def test_custom_rules_path(self):
        """Test custom rules path from environment."""
        with mock.patch.dict(os.environ, {"ROUTER_RULES_PATH": "/custom/path.json"}):
            config = load_config()
            assert config.rules_path == "/custom/path.json"

    def test_debug_enabled(self):
        """Test debug flag enabled."""
        with mock.patch.dict(os.environ, {"ROUTER_DEBUG": "1"}):
            config = load_config()
            assert config.debug is True

    def test_debug_enabled_true_string(self):
        """Test debug flag with 'true' string."""
        with mock.patch.dict(os.environ, {"ROUTER_DEBUG": "true"}):
            config = load_config()
            assert config.debug is True

    def test_debug_disabled(self):
        """Test debug flag disabled."""
        with mock.patch.dict(os.environ, {"ROUTER_DEBUG": "0"}):
            config = load_config()
            assert config.debug is False

    def test_custom_short_threshold(self):
        """Test custom short threshold from environment."""
        with mock.patch.dict(os.environ, {"ROUTER_SHORT_THRESHOLD": "10"}):
            config = load_config()
            assert config.short_threshold == 10

    def test_invalid_short_threshold(self):
        """Test invalid short threshold falls back to default."""
        with mock.patch.dict(os.environ, {"ROUTER_SHORT_THRESHOLD": "invalid"}):
            config = load_config()
            assert config.short_threshold == 5


# === Input/Output Tests ===
class TestReadInput:
    """Tests for read_input function."""

    def test_valid_json(self):
        """Test reading valid JSON input."""
        with mock.patch("sys.stdin.read", return_value='{"prompt": "test"}'):
            result = read_input()
            assert result == {"prompt": "test"}

    def test_empty_input(self):
        """Test empty input returns empty dict."""
        with mock.patch("sys.stdin.read", return_value=""):
            result = read_input()
            assert result == {}

    def test_invalid_json(self):
        """Test invalid JSON returns empty dict."""
        with mock.patch("sys.stdin.read", return_value="not json"):
            result = read_input()
            assert result == {}


class TestWriteOutput:
    """Tests for write_output function."""

    def test_writes_json(self, capsys):
        """Test output is valid JSON."""
        write_output({"test": "value"})
        captured = capsys.readouterr()
        assert json.loads(captured.out) == {"test": "value"}


# === Rules Loading Tests ===
class TestLoadRulesFile:
    """Tests for load_rules_file function."""

    def test_load_valid_rules(self, sample_rules):
        """Test loading a valid rules file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(sample_rules, f)
            f.flush()
            result = load_rules_file(f.name)
            os.unlink(f.name)

        assert result is not None
        assert "agent_categories" in result
        assert "skills" in result

    def test_missing_file(self):
        """Test missing file returns None."""
        result = load_rules_file("/nonexistent/path.json")
        assert result is None

    def test_invalid_json(self):
        """Test invalid JSON returns None."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("not valid json")
            f.flush()
            result = load_rules_file(f.name)
            os.unlink(f.name)

        assert result is None


class TestValidateRules:
    """Tests for validate_rules function."""

    def test_valid_rules(self, sample_rules):
        """Test valid rules passes validation."""
        assert validate_rules(sample_rules) is True

    def test_missing_agent_categories(self, sample_rules):
        """Test rules without agent_categories fails."""
        del sample_rules["agent_categories"]
        assert validate_rules(sample_rules) is False

    def test_missing_skills(self, sample_rules):
        """Test rules without skills fails."""
        del sample_rules["skills"]
        assert validate_rules(sample_rules) is False

    def test_missing_injection_templates(self, sample_rules):
        """Test rules without injection_templates fails."""
        del sample_rules["injection_templates"]
        assert validate_rules(sample_rules) is False


class TestMergeRules:
    """Tests for merge_rules function."""

    def test_no_project_rules(self, sample_rules):
        """Test merging with no project rules."""
        merged, project_agents, project_skills = merge_rules(sample_rules, None)
        assert merged == sample_rules
        assert len(project_agents) == 0
        assert len(project_skills) == 0

    def test_merge_skill_mappings(self, sample_rules, sample_project_rules):
        """Test skill mappings are merged."""
        merged, project_agents, project_skills = merge_rules(sample_rules, sample_project_rules)
        # vercel and jest should be marked as project skills
        assert "vercel" in project_skills
        assert "jest" in project_skills


# === Word Count Tests ===
class TestCountWords:
    """Tests for count_words function."""

    def test_empty_string(self):
        """Test empty string returns 0."""
        assert count_words("") == 0

    def test_single_word(self):
        """Test single word."""
        assert count_words("hello") == 1

    def test_multiple_words(self):
        """Test multiple words."""
        assert count_words("hello world") == 2
        assert count_words("one two three four five") == 5

    def test_extra_whitespace(self):
        """Test extra whitespace is handled."""
        assert count_words("hello  world") == 2


# === Category Matching Tests ===
class TestMatchAgentCategories:
    """Tests for match_agent_categories function."""

    def test_single_trigger_match(self, sample_rules):
        """Test matching a single trigger."""
        matches, project_agents = match_agent_categories("Implement the feature", sample_rules, set())
        assert len(matches) > 0
        category, count, agents = matches[0]
        assert category == "development"
        assert count >= 1

    def test_multiple_trigger_match(self, sample_rules):
        """Test matching multiple triggers."""
        matches, project_agents = match_agent_categories("Build a frontend component", sample_rules, set())
        assert len(matches) > 0
        category, count, agents = matches[0]
        assert count >= 2  # "build" and "frontend"

    def test_no_matches(self, sample_rules):
        """Test no matches returns empty list."""
        matches, project_agents = match_agent_categories("Hello world", sample_rules, set())
        assert len(matches) == 0

    def test_sorted_by_match_count(self, sample_rules):
        """Test results are sorted by match count."""
        matches, project_agents = match_agent_categories("Test and review the code", sample_rules, set())
        if len(matches) >= 2:
            assert matches[0][1] >= matches[1][1]


# === Skill Matching Tests ===
class TestMatchSkills:
    """Tests for match_skills function."""

    def test_trigger_match(self, sample_rules):
        """Test matching skill trigger."""
        matches, project_skills = match_skills("Run jest tests", sample_rules, set())
        assert len(matches) > 0
        skill_name, count, purpose = matches[0]
        assert skill_name == "jest"

    def test_pattern_match(self, sample_rules):
        """Test matching skill pattern."""
        matches, project_skills = match_skills("Deploy to vercel now", sample_rules, set())
        assert len(matches) > 0
        skill_names = [m[0] for m in matches]
        assert "vercel" in skill_names

    def test_no_matches(self, sample_rules):
        """Test no matches returns empty list."""
        matches, project_skills = match_skills("Random unrelated text", sample_rules, set())
        assert len(matches) == 0

    def test_multiple_skill_matches(self, sample_rules):
        """Test matching multiple skills."""
        matches, project_skills = match_skills("Run jest tests then deploy to vercel", sample_rules, set())
        skill_names = [m[0] for m in matches]
        assert "jest" in skill_names
        assert "vercel" in skill_names


# === Analyze Prompt Tests ===
class TestAnalyzePrompt:
    """Tests for analyze_prompt function."""

    def test_matched_categories(self, sample_rules):
        """Test categories are matched."""
        result = analyze_prompt("Implement the backend API", sample_rules, set(), set())
        assert "development" in result.matched_categories

    def test_matched_agents(self, sample_rules):
        """Test agents are included."""
        result = analyze_prompt("Build the frontend", sample_rules, set(), set())
        agent_names = [a.get("name") for a in result.matched_agents]
        assert "frontend-developer" in agent_names or "backend-developer" in agent_names

    def test_matched_skills(self, sample_rules):
        """Test skills are matched."""
        result = analyze_prompt("Run jest tests", sample_rules, set(), set())
        assert "jest" in result.matched_skills

    def test_deduplication(self, sample_rules):
        """Test agents are deduplicated."""
        result = analyze_prompt("Implement frontend backend code build", sample_rules, set(), set())
        agent_names = [a.get("name") for a in result.matched_agents]
        assert len(agent_names) == len(set(agent_names))

    def test_word_count_tracked(self, sample_rules):
        """Test word count is tracked."""
        result = analyze_prompt("one two three", sample_rules, set(), set())
        assert result.word_count == 3

    def test_project_matches_tracked(self, sample_rules):
        """Test project-specific matches are tracked."""
        project_agents = {"frontend-developer"}
        result = analyze_prompt("Build the frontend", sample_rules, project_agents, set())
        assert "frontend-developer" in result.project_matched_agents
        assert result.has_project_matches is True


# === Scenario Determination Tests ===
class TestDetermineScenario:
    """Tests for determine_scenario function."""

    def test_short_no_match(self, config):
        """Test short prompts with no matches."""
        result = MatchResult(word_count=2, match_count=0)
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.SHORT_NO_MATCH

    def test_long_no_match(self, config):
        """Test longer prompts with no matches."""
        result = MatchResult(word_count=10, match_count=0)
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.LONG_NO_MATCH

    def test_agents_only(self, config):
        """Test agents matched, no skills."""
        result = MatchResult(
            word_count=10,
            matched_agents=[{"name": "test-runner", "purpose": "Run tests"}],
            match_count=1,
        )
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.AGENTS_ONLY

    def test_skills_only(self, config):
        """Test skills matched, no agents."""
        result = MatchResult(
            word_count=10,
            matched_skills=["jest"],
            match_count=1,
        )
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.SKILLS_ONLY

    def test_agents_and_skills(self, config):
        """Test both agents and skills matched."""
        result = MatchResult(
            word_count=10,
            matched_agents=[{"name": "test-runner", "purpose": "Run tests"}],
            matched_skills=["jest"],
            match_count=2,
        )
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.AGENTS_AND_SKILLS

    def test_short_threshold_boundary(self, config):
        """Test boundary at short threshold."""
        # Exactly at threshold (5 words) should be considered long
        result = MatchResult(word_count=5, match_count=0)
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.LONG_NO_MATCH

        # Below threshold (4 words) should be short
        result = MatchResult(word_count=4, match_count=0)
        scenario = determine_scenario(result, config)
        assert scenario == Scenario.SHORT_NO_MATCH


# === Template Building Tests ===
class TestBuildShortNoMatchHint:
    """Tests for build_short_no_match_hint function."""

    def test_generates_hint(self, sample_rules):
        """Test short no match hint is generated."""
        hint = build_short_no_match_hint(sample_rules)
        assert "orchestrator" in hint
        assert "delegate" in hint.lower()


class TestBuildLongNoMatchHint:
    """Tests for build_long_no_match_hint function."""

    def test_generates_hint(self, sample_rules):
        """Test long no match hint is generated."""
        hint = build_long_no_match_hint(sample_rules)
        assert "orchestrator" in hint
        assert "delegate" in hint.lower()


class TestBuildAgentsOnlyHint:
    """Tests for build_agents_only_hint function."""

    def test_generates_hint(self, sample_rules):
        """Test agents only hint is generated."""
        result = MatchResult(
            matched_agents=[
                {"name": "frontend-developer", "purpose": "UI development"},
            ],
        )
        hint = build_agents_only_hint(result, sample_rules)
        assert "frontend-developer" in hint
        assert "MUST delegate" in hint

    def test_project_specific_hint(self, sample_rules):
        """Test project-specific agents get stronger language."""
        result = MatchResult(
            matched_agents=[
                {"name": "frontend-developer", "purpose": "UI development"},
            ],
            project_matched_agents=["frontend-developer"],
            has_project_matches=True,
        )
        hint = build_agents_only_hint(result, sample_rules)
        assert "MANDATORY" in hint


class TestBuildSkillsOnlyHint:
    """Tests for build_skills_only_hint function."""

    def test_generates_hint(self, sample_rules):
        """Test skills only hint is generated."""
        result = MatchResult(matched_skills=["jest", "vercel"])
        hint = build_skills_only_hint(result, sample_rules)
        assert "skill(s)" in hint
        assert "jest" in hint
        assert "vercel" in hint


class TestBuildAgentsAndSkillsHint:
    """Tests for build_agents_and_skills_hint function."""

    def test_generates_hint(self, sample_rules):
        """Test agents and skills hint is generated."""
        result = MatchResult(
            matched_agents=[
                {"name": "frontend-developer", "purpose": "UI development"},
            ],
            matched_skills=["jest", "vercel"],
        )
        hint = build_agents_and_skills_hint(result, sample_rules)
        assert "frontend-developer" in hint
        assert "jest" in hint
        assert "Task prompt" in hint


class TestBuildHint:
    """Tests for build_hint function."""

    def test_dispatches_to_correct_builder(self, sample_rules):
        """Test hint builder dispatches correctly."""
        result = MatchResult(matched_skills=["jest"])

        hint = build_hint(Scenario.SHORT_NO_MATCH, result, sample_rules)
        assert "orchestrator" in hint

        hint = build_hint(Scenario.LONG_NO_MATCH, result, sample_rules)
        assert "orchestrator" in hint

        hint = build_hint(Scenario.SKILLS_ONLY, result, sample_rules)
        assert "jest" in hint


# === Output Generation Tests ===
class TestBuildOutput:
    """Tests for build_output function."""

    def test_always_injects_hint(self, sample_rules, config):
        """Test hints are always injected (no more blocking)."""
        # Even with no matches, we get a hint
        result = MatchResult(word_count=10, match_count=0)
        output = build_output(result, sample_rules, config)
        assert "additionalContext" in output["hookSpecificOutput"]

    def test_short_no_match_hint(self, sample_rules, config):
        """Test short no match gets appropriate hint."""
        result = MatchResult(word_count=2, match_count=0)
        output = build_output(result, sample_rules, config)
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "orchestrator" in output["hookSpecificOutput"]["additionalContext"]

    def test_agents_only_hint(self, sample_rules, config):
        """Test agents only gets appropriate hint."""
        result = MatchResult(
            word_count=10,
            matched_agents=[{"name": "frontend-developer", "purpose": "UI"}],
            match_count=1,
        )
        output = build_output(result, sample_rules, config)
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "frontend-developer" in output["hookSpecificOutput"]["additionalContext"]

    def test_agents_and_skills_hint(self, sample_rules, config):
        """Test agents and skills gets appropriate hint."""
        result = MatchResult(
            word_count=10,
            matched_agents=[{"name": "frontend-developer", "purpose": "UI"}],
            matched_skills=["jest"],
            match_count=2,
        )
        output = build_output(result, sample_rules, config)
        assert "additionalContext" in output["hookSpecificOutput"]
        hint = output["hookSpecificOutput"]["additionalContext"]
        assert "frontend-developer" in hint
        assert "jest" in hint
        assert "Task prompt" in hint

    def test_output_format(self, sample_rules, config):
        """Test output has correct format."""
        result = MatchResult(word_count=10, match_count=0)
        output = build_output(result, sample_rules, config)
        assert "hookSpecificOutput" in output
        assert "hookEventName" in output["hookSpecificOutput"]
        assert output["hookSpecificOutput"]["hookEventName"] == "UserPromptSubmit"


# === Integration Tests ===
class TestIntegration:
    """Integration tests for the router."""

    def test_full_flow_with_agent_match(self, sample_rules, config):
        """Test full flow with agent matching prompt."""
        prompt = "Implement the frontend component"
        result = analyze_prompt(prompt, sample_rules, set(), set())
        output = build_output(result, sample_rules, config)

        assert result.match_count > 0
        assert "development" in result.matched_categories
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "frontend-developer" in output["hookSpecificOutput"]["additionalContext"]

    def test_full_flow_with_skill_match(self, sample_rules, config):
        """Test full flow with skill matching prompt."""
        prompt = "Run jest tests"
        result = analyze_prompt(prompt, sample_rules, set(), set())
        output = build_output(result, sample_rules, config)

        assert "jest" in result.matched_skills
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "jest" in output["hookSpecificOutput"]["additionalContext"]

    def test_full_flow_with_both_matches(self, sample_rules, config):
        """Test full flow with both agent and skill matches."""
        prompt = "Build the frontend and run jest tests"
        result = analyze_prompt(prompt, sample_rules, set(), set())
        output = build_output(result, sample_rules, config)

        assert len(result.matched_agents) > 0
        assert "jest" in result.matched_skills
        assert "Task prompt" in output["hookSpecificOutput"]["additionalContext"]

    def test_full_flow_short_no_match(self, sample_rules, config):
        """Test full flow with short prompt, no matches."""
        prompt = "thanks"
        result = analyze_prompt(prompt, sample_rules, set(), set())
        output = build_output(result, sample_rules, config)

        assert result.word_count < config.short_threshold
        assert result.match_count == 0
        assert "orchestrator" in output["hookSpecificOutput"]["additionalContext"]

    def test_full_flow_long_no_match(self, sample_rules, config):
        """Test full flow with long prompt, no matches."""
        prompt = "Random text that matches nothing in particular here"
        result = analyze_prompt(prompt, sample_rules, set(), set())
        output = build_output(result, sample_rules, config)

        assert result.word_count >= config.short_threshold
        assert result.match_count == 0
        assert "orchestrator" in output["hookSpecificOutput"]["additionalContext"]

    def test_question_prompts_not_blocked(self, sample_rules, config):
        """Test that question prompts (formerly anti-routed) are not blocked."""
        prompts = [
            "What is Python?",
            "How does React work?",
            "Can you help me with this?",
            "Why is this failing?",
        ]
        for prompt in prompts:
            result = analyze_prompt(prompt, sample_rules, set(), set())
            output = build_output(result, sample_rules, config)
            # All prompts should get a hint (no blocking)
            assert "additionalContext" in output["hookSpecificOutput"], f"Failed for: {prompt}"


# === Edge Case Tests ===
class TestEdgeCases:
    """Tests for edge cases."""

    def test_empty_prompt(self, sample_rules):
        """Test empty prompt."""
        result = analyze_prompt("", sample_rules, set(), set())
        assert result.match_count == 0

    def test_case_insensitivity(self, sample_rules):
        """Test matching is case insensitive."""
        result1 = analyze_prompt("IMPLEMENT the feature", sample_rules, set(), set())
        result2 = analyze_prompt("implement the feature", sample_rules, set(), set())
        assert result1.match_count == result2.match_count

    def test_partial_word_not_matched(self, sample_rules):
        """Test partial words don't match."""
        # "implementation" contains "implement" but shouldn't match as word boundary
        result = analyze_prompt("The implementation details", sample_rules, set(), set())
        # Should not match "implement" trigger due to word boundary
        assert "development" not in result.matched_categories or result.match_count == 0

    def test_multiple_categories_matched(self, sample_rules):
        """Test multiple categories can be matched."""
        result = analyze_prompt("Implement and test the code review", sample_rules, set(), set())
        assert len(result.matched_categories) >= 1

    def test_long_prompt(self, sample_rules):
        """Test handling of long prompts."""
        long_prompt = "Implement " * 1000
        result = analyze_prompt(long_prompt, sample_rules, set(), set())
        assert result is not None  # Should not crash


# === Normalize Text Tests ===
class TestNormalizeText:
    """Tests for normalize_text function."""

    def test_lowercase(self):
        """Test text is lowercased."""
        assert normalize_text("HELLO") == "hello"

    def test_strip_whitespace(self):
        """Test whitespace is stripped."""
        assert normalize_text("  hello  ") == "hello"

    def test_combined(self):
        """Test both operations together."""
        assert normalize_text("  HELLO WORLD  ") == "hello world"


# === Scenario Enum Tests ===
class TestScenarioEnum:
    """Tests for Scenario enum."""

    def test_all_scenarios_defined(self):
        """Test all scenarios are defined."""
        assert hasattr(Scenario, "SHORT_NO_MATCH")
        assert hasattr(Scenario, "AGENTS_ONLY")
        assert hasattr(Scenario, "AGENTS_AND_SKILLS")
        assert hasattr(Scenario, "SKILLS_ONLY")
        assert hasattr(Scenario, "LONG_NO_MATCH")

    def test_scenario_values(self):
        """Test scenario values are strings."""
        assert Scenario.SHORT_NO_MATCH.value == "short_no_match"
        assert Scenario.AGENTS_ONLY.value == "agents_only"
        assert Scenario.AGENTS_AND_SKILLS.value == "agents_and_skills"
        assert Scenario.SKILLS_ONLY.value == "skills_only"
        assert Scenario.LONG_NO_MATCH.value == "long_no_match"


# === Match Result Tests ===
class TestMatchResult:
    """Tests for MatchResult dataclass."""

    def test_default_values(self):
        """Test default values are empty."""
        result = MatchResult()
        assert result.matched_categories == []
        assert result.matched_agents == []
        assert result.matched_skills == []
        assert result.match_count == 0
        assert result.word_count == 0
        assert result.project_matched_agents == []
        assert result.project_matched_skills == []
        assert result.has_project_matches is False

    def test_project_matches_flag(self):
        """Test has_project_matches flag."""
        result = MatchResult(
            project_matched_agents=["frontend-developer"],
            has_project_matches=True,
        )
        assert result.has_project_matches is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
