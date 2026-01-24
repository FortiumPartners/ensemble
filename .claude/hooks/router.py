#!/usr/bin/env python3
"""
UserPromptSubmit Router Hook for Claude Code.

Analyzes user prompts using keyword matching against routing rules to provide
routing hints for specialized subagents or skills. Supports both global rules
and project-specific rules that are merged together.

No external API calls - uses pattern matching against router-rules.json.
Always injects context-appropriate guidance.

Zero dependencies - uses only Python stdlib.

Environment Variables:
    ROUTER_RULES_PATH: Override path to global router-rules.json (takes precedence over all other locations)
    ROUTER_DEBUG: Enable debug logging to stderr (default: 0)
    ROUTER_SHORT_THRESHOLD: Word count threshold for "short" prompts (default: 5)
    ROUTER_STRICT_VALIDATION: Enable structural validation of rules (default: 1)
    ROUTER_CUSTOM_DISCOVERY: Enable custom agent/skill discovery (default: 1)

Global Rules Discovery:
    The router searches for global rules in multiple locations (in order):
    1. ROUTER_RULES_PATH environment variable (if set)
    2. Vendored location: {cwd}/.claude/lib/router-rules.json
    3. Plugin location: ../lib/router-rules.json (relative to script)

    This allows the router to work in both vendored scenarios (rules copied
    to project .claude/lib/) and plugin development scenarios.

Project Rules:
    The router also checks for .claude/router-rules.json in the current working
    directory. Project rules are merged with global rules, with project-specific
    triggers and skills taking precedence.

    Note: Project rules are SEPARATE from global rules. Global rules define
    the base agent and skill catalog, while project rules extend or customize
    routing for specific projects.

    Custom agents defined in the project's `custom_agents` section are merged
    into the utility agent category for routing purposes.

Exit Codes:
    Always exits with 0 to never block user prompts.
"""

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


# === Constants ===
DEFAULT_SHORT_THRESHOLD = 5
PROJECT_RULES_PATH = ".claude/router-rules.json"
GLOBAL_RULES_FILENAME = "router-rules.json"
VENDORED_GLOBAL_RULES_PATH = ".claude/lib/router-rules.json"
STRICT_VALIDATION_ENV = "ROUTER_STRICT_VALIDATION"
CUSTOM_DISCOVERY_ENV = "ROUTER_CUSTOM_DISCOVERY"


# === Enums ===
class Scenario(Enum):
    """Routing scenarios for template selection."""
    SHORT_NO_MATCH = "short_no_match"
    AGENTS_ONLY = "agents_only"
    AGENTS_AND_SKILLS = "agents_and_skills"
    SKILLS_ONLY = "skills_only"
    LONG_NO_MATCH = "long_no_match"


# === Data Classes ===
@dataclass
class RouterConfig:
    """Router configuration from environment."""
    rules_path: str
    debug: bool
    short_threshold: int
    strict_validation: bool = True
    custom_discovery: bool = True
    cwd: str = ""


@dataclass
class MatchResult:
    """Result of keyword matching against a prompt."""
    matched_categories: List[str] = field(default_factory=list)
    matched_agents: List[Dict[str, str]] = field(default_factory=list)
    matched_skills: List[str] = field(default_factory=list)
    match_count: int = 0
    word_count: int = 0
    # Track project-specific matches for stronger recommendations
    project_matched_agents: List[str] = field(default_factory=list)
    project_matched_skills: List[str] = field(default_factory=list)
    has_project_matches: bool = False


# === Logging Functions ===
def log_debug(config: RouterConfig, message: str) -> None:
    """Log debug message to stderr if debug mode is enabled."""
    if config.debug:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"[ROUTER DEBUG {timestamp}] {message}", file=sys.stderr)


def log_error(message: str) -> None:
    """Log error message to stderr."""
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ROUTER ERROR {timestamp}] {message}", file=sys.stderr)


# === Configuration Functions ===
def get_default_rules_path() -> str:
    """Get the default path to router-rules.json relative to this script.

    This is the fallback location used in plugin development mode.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(script_dir, '..', 'lib', GLOBAL_RULES_FILENAME)


def find_global_rules_path(cwd: str, env_path: Optional[str] = None) -> Optional[str]:
    """
    Find the global router rules file, checking multiple locations.

    Search order:
    1. Environment variable path (if provided)
    2. Vendored location in project: {cwd}/.claude/lib/router-rules.json
    3. Relative to script: ../lib/router-rules.json (plugin development)

    This allows the router to work in both vendored scenarios (where rules
    are copied to .claude/lib/) and plugin development scenarios (where
    rules are in the source tree).

    Args:
        cwd: Current working directory (project root)
        env_path: Path from ROUTER_RULES_PATH environment variable

    Returns:
        Path to first found rules file, or None if not found
    """
    candidates = []

    # 1. Environment variable takes precedence
    if env_path:
        candidates.append(os.path.normpath(env_path))

    # 2. Vendored location in project .claude/lib/
    if cwd:
        vendored_path = os.path.join(cwd, VENDORED_GLOBAL_RULES_PATH)
        candidates.append(os.path.normpath(vendored_path))

    # 3. Default location relative to script (plugin development)
    default_path = get_default_rules_path()
    candidates.append(os.path.normpath(default_path))

    # Return first existing file
    for path in candidates:
        if os.path.isfile(path):
            return path

    return None


def load_config() -> RouterConfig:
    """Load router configuration from environment variables."""
    rules_path = os.environ.get("ROUTER_RULES_PATH", get_default_rules_path())
    debug_str = os.environ.get("ROUTER_DEBUG", "0")
    debug = debug_str.lower() in ("1", "true", "yes")

    short_threshold_str = os.environ.get("ROUTER_SHORT_THRESHOLD", str(DEFAULT_SHORT_THRESHOLD))
    try:
        short_threshold = int(short_threshold_str)
    except ValueError:
        short_threshold = DEFAULT_SHORT_THRESHOLD

    strict_validation_str = os.environ.get(STRICT_VALIDATION_ENV, "1")
    strict_validation = strict_validation_str.lower() in ("1", "true", "yes")

    custom_discovery_str = os.environ.get(CUSTOM_DISCOVERY_ENV, "1")
    custom_discovery = custom_discovery_str.lower() in ("1", "true", "yes")

    return RouterConfig(
        rules_path=rules_path,
        debug=debug,
        short_threshold=short_threshold,
        strict_validation=strict_validation,
        custom_discovery=custom_discovery,
        cwd=os.getcwd(),
    )


# === Input/Output Functions ===
def read_input() -> Dict[str, Any]:
    """Read and parse JSON from stdin."""
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            return {}
        return json.loads(raw_input)
    except json.JSONDecodeError:
        return {}
    except Exception:
        return {}


def write_output(output: Dict[str, Any]) -> None:
    """Write JSON output to stdout."""
    print(json.dumps(output))


# === Rules Loading Functions ===
def load_rules_file(path: str) -> Optional[Dict[str, Any]]:
    """Load routing rules from a JSON file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, Exception):
        return None


def load_global_rules(config: RouterConfig, cwd: str = "") -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Load global routing rules from multiple possible locations.

    Searches in order:
    1. ROUTER_RULES_PATH environment variable (if set)
    2. Vendored location: {cwd}/.claude/lib/router-rules.json
    3. Plugin location: ../lib/router-rules.json (relative to script)

    Args:
        config: Router configuration
        cwd: Current working directory for vendored rules lookup

    Returns:
        Tuple of (rules dict or None, path where found or None)
    """
    # Check if env var was explicitly set
    env_path = os.environ.get("ROUTER_RULES_PATH")

    # Find the rules file in multiple locations
    found_path = find_global_rules_path(cwd, env_path)

    if found_path:
        rules = load_rules_file(found_path)
        return rules, found_path

    # Fallback: try the config path directly (backwards compatibility)
    path = os.path.normpath(config.rules_path)
    rules = load_rules_file(path)
    return rules, path if rules else None


def load_project_rules(config: RouterConfig, input_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Load project-specific routing rules if they exist."""
    # First try cwd from input data (hook provides this)
    cwd = input_data.get("cwd", config.cwd)
    if not cwd:
        return None

    project_path = os.path.join(cwd, PROJECT_RULES_PATH)
    return load_rules_file(project_path)


def merge_rules(global_rules: Dict[str, Any], project_rules: Optional[Dict[str, Any]]) -> Tuple[Dict[str, Any], Set[str], Set[str]]:
    """
    Merge project rules into global rules.

    Returns:
        - Merged rules dictionary
        - Set of project-specific agent names
        - Set of project-specific skill names
    """
    if not project_rules:
        return global_rules, set(), set()

    merged = json.loads(json.dumps(global_rules))  # Deep copy
    project_agents: Set[str] = set()
    project_skills: Set[str] = set()

    # Merge project_context triggers into categories
    if "project_context" in project_rules:
        for context_key, skills_or_agents in project_rules["project_context"].items():
            # Add project context skills to the project_skills set
            if isinstance(skills_or_agents, list):
                project_skills.update(skills_or_agents)

    # Merge additional triggers into existing categories
    if "triggers" in project_rules:
        for category, triggers in project_rules["triggers"].items():
            if category in merged.get("agent_categories", {}):
                existing = merged["agent_categories"][category].get("triggers", [])
                merged["agent_categories"][category]["triggers"] = existing + triggers
                # Mark agents from this category as project-specific
                for agent in merged["agent_categories"][category].get("agents", []):
                    project_agents.add(agent.get("name", ""))

    # Merge additional skills
    if "skills" in project_rules:
        for skill_name, skill_data in project_rules["skills"].items():
            if skill_name in merged.get("skills", {}):
                # Extend existing skill triggers
                existing = merged["skills"][skill_name].get("triggers", [])
                new_triggers = skill_data.get("triggers", [])
                merged["skills"][skill_name]["triggers"] = existing + new_triggers
            else:
                # Add new skill
                merged["skills"][skill_name] = skill_data
            project_skills.add(skill_name)

    # Merge skill_mappings (keyword -> skill associations)
    if "skill_mappings" in project_rules:
        for keyword, skills in project_rules["skill_mappings"].items():
            # Add keyword as trigger to each mapped skill
            for skill_name in skills:
                if skill_name in merged.get("skills", {}):
                    existing = merged["skills"][skill_name].get("triggers", [])
                    if keyword not in existing:
                        merged["skills"][skill_name]["triggers"].append(keyword)
                    project_skills.add(skill_name)

    # Merge custom agents into utility category
    if "custom_agents" in project_rules:
        try:
            for agent_name, agent_data in project_rules["custom_agents"].items():
                if not isinstance(agent_data, dict):
                    continue
                # Add to utility category by default
                if "utility" in merged.get("agent_categories", {}):
                    merged["agent_categories"]["utility"]["agents"].append({
                        "name": agent_name,
                        "purpose": agent_data.get("description", "Custom project agent"),
                        "tools": agent_data.get("tools", [])
                    })
                    # Add triggers from custom agent
                    if "triggers" in agent_data and isinstance(agent_data["triggers"], list):
                        merged["agent_categories"]["utility"]["triggers"].extend(agent_data["triggers"])
                    project_agents.add(agent_name)
        except Exception:
            pass  # Graceful degradation - ignore malformed custom_agents

    return merged, project_agents, project_skills


def validate_rules(rules: Dict[str, Any]) -> bool:
    """Validate rules have required sections."""
    required_keys = ["agent_categories", "skills", "injection_templates"]
    return all(key in rules for key in required_keys)


def validate_rules_structure(rules: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate rules structure with detailed error reporting.

    Performs structural validation of router rules, checking that all required
    keys exist and have the expected types and nested structure.

    Args:
        rules: The router rules dictionary to validate.

    Returns:
        - (True, []) if valid
        - (False, [list of errors]) if invalid
    """
    errors: List[str] = []

    # Check required top-level keys
    required_keys = ["agent_categories", "skills", "injection_templates"]
    for key in required_keys:
        if key not in rules:
            errors.append(f"Missing required key: {key}")

    if errors:
        return False, errors

    # Validate agent_categories structure
    if not isinstance(rules.get("agent_categories"), dict):
        errors.append("agent_categories must be an object")
    else:
        for cat_name, cat_data in rules["agent_categories"].items():
            if not isinstance(cat_data, dict):
                errors.append(f"agent_categories.{cat_name} must be an object")
                continue
            if "triggers" not in cat_data:
                errors.append(f"agent_categories.{cat_name} missing 'triggers'")
            elif not isinstance(cat_data.get("triggers"), list):
                errors.append(f"agent_categories.{cat_name}.triggers must be an array")
            if "agents" not in cat_data:
                errors.append(f"agent_categories.{cat_name} missing 'agents'")
            elif not isinstance(cat_data.get("agents"), list):
                errors.append(f"agent_categories.{cat_name}.agents must be an array")

    # Validate skills structure
    if not isinstance(rules.get("skills"), dict):
        errors.append("skills must be an object")
    else:
        for skill_name, skill_data in rules["skills"].items():
            if not isinstance(skill_data, dict):
                errors.append(f"skills.{skill_name} must be an object")
                continue
            if "triggers" not in skill_data:
                errors.append(f"skills.{skill_name} missing 'triggers'")
            elif not isinstance(skill_data.get("triggers"), list):
                errors.append(f"skills.{skill_name}.triggers must be an array")

    # Validate injection_templates structure
    if not isinstance(rules.get("injection_templates"), dict):
        errors.append("injection_templates must be an object")

    return len(errors) == 0, errors


# === Keyword Matching Functions ===
def normalize_text(text: str) -> str:
    """Normalize text for case-insensitive matching."""
    return text.lower().strip()


def count_words(text: str) -> int:
    """Count words in text."""
    return len(text.split())


def match_agent_categories(
    prompt: str, rules: Dict[str, Any], project_agents: Set[str]
) -> Tuple[List[tuple], List[str]]:
    """
    Match prompt against agent category triggers.

    Returns:
        - List of (category_name, match_count, agents) tuples
        - List of project-specific agent names that matched
    """
    results = []
    matched_project_agents = []
    prompt_lower = normalize_text(prompt)
    categories = rules.get("agent_categories", {})

    for category_name, category_data in categories.items():
        triggers = category_data.get("triggers", [])
        agents = category_data.get("agents", [])
        match_count = 0

        for trigger in triggers:
            trigger_lower = trigger.lower()
            if re.search(r'\b' + re.escape(trigger_lower) + r'\b', prompt_lower):
                match_count += 1

        if match_count > 0:
            results.append((category_name, match_count, agents))
            # Check if any agents are project-specific
            for agent in agents:
                if agent.get("name", "") in project_agents:
                    matched_project_agents.append(agent.get("name", ""))

    results.sort(key=lambda x: x[1], reverse=True)
    return results, matched_project_agents


def match_skills(
    prompt: str, rules: Dict[str, Any], project_skills: Set[str], config: RouterConfig
) -> Tuple[List[tuple], List[str]]:
    """
    Match prompt against skill triggers and patterns.

    Returns:
        - List of (skill_name, match_count, purpose) tuples
        - List of project-specific skill names that matched
    """
    results = []
    matched_project_skills = []
    prompt_lower = normalize_text(prompt)
    skills = rules.get("skills", {})

    for skill_name, skill_data in skills.items():
        triggers = skill_data.get("triggers", [])
        patterns = skill_data.get("patterns", [])
        purpose = skill_data.get("purpose", "")
        match_count = 0

        for trigger in triggers:
            trigger_lower = trigger.lower()
            if re.search(r'\b' + re.escape(trigger_lower) + r'\b', prompt_lower):
                match_count += 1

        for pattern in patterns:
            try:
                if re.search(pattern, prompt_lower, re.IGNORECASE):
                    match_count += 2
            except re.error as e:
                log_debug(config, f"Invalid pattern '{pattern}': {e}")

        if match_count > 0:
            results.append((skill_name, match_count, purpose))
            if skill_name in project_skills:
                matched_project_skills.append(skill_name)

    results.sort(key=lambda x: x[1], reverse=True)
    return results, matched_project_skills


def analyze_prompt(
    prompt: str,
    rules: Dict[str, Any],
    project_agents: Set[str],
    project_skills: Set[str],
    config: RouterConfig
) -> MatchResult:
    """Analyze a prompt against the rules and return matches."""
    result = MatchResult()
    result.word_count = count_words(prompt)

    # Match agent categories
    category_matches, matched_proj_agents = match_agent_categories(prompt, rules, project_agents)
    for category_name, match_count, agents in category_matches:
        result.matched_categories.append(category_name)
        result.matched_agents.extend(agents[:2])
        result.match_count += match_count
    result.project_matched_agents = matched_proj_agents

    # Match skills
    skill_matches, matched_proj_skills = match_skills(prompt, rules, project_skills, config)
    for skill_name, match_count, purpose in skill_matches[:3]:
        result.matched_skills.append(skill_name)
        result.match_count += match_count
    result.project_matched_skills = matched_proj_skills

    # Track if we have any project-specific matches
    result.has_project_matches = bool(matched_proj_agents or matched_proj_skills)

    # Deduplicate agents
    seen_agents: Set[str] = set()
    unique_agents = []
    for agent in result.matched_agents:
        agent_name = agent.get("name", "")
        if agent_name and agent_name not in seen_agents:
            seen_agents.add(agent_name)
            unique_agents.append(agent)
    result.matched_agents = unique_agents[:4]

    return result


# === Scenario Determination ===
def determine_scenario(result: MatchResult, config: RouterConfig) -> Scenario:
    """Determine which scenario applies based on matches and prompt length."""
    has_agents = len(result.matched_agents) > 0
    has_skills = len(result.matched_skills) > 0
    is_short = result.word_count < config.short_threshold

    if has_agents and has_skills:
        return Scenario.AGENTS_AND_SKILLS
    elif has_agents:
        return Scenario.AGENTS_ONLY
    elif has_skills:
        return Scenario.SKILLS_ONLY
    elif is_short:
        return Scenario.SHORT_NO_MATCH
    else:
        return Scenario.LONG_NO_MATCH


# === Template Building ===
def build_short_no_match_hint(rules: Dict[str, Any]) -> str:
    """Build hint for short prompts with no matches."""
    templates = rules.get("injection_templates", {})
    template_config = templates.get("short_no_match", {})

    return template_config.get(
        "template",
        "Short prompt - review conversation context. If continuing established work "
        "(e.g., \"proceed\", \"go ahead\"), maintain the current approach including any "
        "active subagent delegation. For new implementation tasks, delegate to a specialized subagent."
    )


def build_long_no_match_hint(rules: Dict[str, Any]) -> str:
    """Build hint for longer prompts with no matches."""
    templates = rules.get("injection_templates", {})
    template_config = templates.get("long_no_match", {})

    return template_config.get(
        "template",
        "No specific agent/skill match found. If this involves implementation (code, commands, "
        "file changes), consider delegating to an appropriate subagent - review available agents "
        "via Task(subagent_type=...). Respond directly for informational requests."
    )


def build_agents_only_hint(result: MatchResult, rules: Dict[str, Any]) -> str:
    """Build hint when only agents are matched (no skills)."""
    templates = rules.get("injection_templates", {})

    # Use stronger template if project-specific matches
    if result.has_project_matches:
        template_config = templates.get("project_agents_only", templates.get("agents_only", {}))
    else:
        template_config = templates.get("agents_only", {})

    # Format agent list
    agent_lines = []
    for agent in result.matched_agents[:3]:
        name = agent.get("name", "")
        purpose = agent.get("purpose", "")
        # Mark project-specific agents
        if name in result.project_matched_agents:
            agent_lines.append(f"  - {name}: {purpose} [PROJECT-SPECIFIC]")
        else:
            agent_lines.append(f"  - {name}: {purpose}")
    agent_list = "\n".join(agent_lines)

    if result.has_project_matches:
        default_template = (
            "Project-configured match. Delegate implementation to one of these subagents:\n"
            "{agent_list}\n\n"
            "You are an orchestrator. Implementation (code, commands, file changes) belongs in subagents.\n\n"
            "Respond directly only if this is clearly a mismatch, or for clarifying questions and factual lookups."
        )
    else:
        default_template = (
            "Delegate implementation to one of these subagents:\n"
            "{agent_list}\n\n"
            "You are an orchestrator. Implementation (code, commands, file changes) belongs in subagents.\n\n"
            "Respond directly only for: clarifying questions, factual lookups, or pure conversation."
        )

    template = template_config.get("template", default_template)
    return template.format(agent_list=agent_list)


def build_skills_only_hint(result: MatchResult, rules: Dict[str, Any]) -> str:
    """Build hint when only skills are matched (no agents)."""
    templates = rules.get("injection_templates", {})

    if result.has_project_matches:
        template_config = templates.get("project_skills_only", templates.get("skills_only", {}))
    else:
        template_config = templates.get("skills_only", {})

    # Mark project-specific skills
    skill_parts = []
    for skill in result.matched_skills[:3]:
        if skill in result.project_matched_skills:
            skill_parts.append(f"{skill} [PROJECT]")
        else:
            skill_parts.append(skill)
    skill_list = ", ".join(skill_parts)

    if result.has_project_matches:
        default_template = (
            "Project-configured skill(s): {skill_list}\n\n"
            "Invoke with: Skill(skill=\"[skill-name]\")\n\n"
            "If delegating to a subagent, instruct them to invoke the skill and report back.\n\n"
            "Skip only if this is clearly a mismatch."
        )
    else:
        default_template = (
            "Use these skill(s) for this request: {skill_list}\n\n"
            "Invoke with: Skill(skill=\"[skill-name]\")\n\n"
            "If delegating to a subagent, instruct them to invoke the skill and report back."
        )

    template = template_config.get("template", default_template)
    return template.format(skill_list=skill_list)


def build_agents_and_skills_hint(result: MatchResult, rules: Dict[str, Any]) -> str:
    """Build hint when both agents and skills are matched."""
    templates = rules.get("injection_templates", {})

    if result.has_project_matches:
        template_config = templates.get("project_agents_and_skills", templates.get("agents_and_skills", {}))
    else:
        template_config = templates.get("agents_and_skills", {})

    # Format agent list with project markers
    agent_lines = []
    for agent in result.matched_agents[:3]:
        name = agent.get("name", "")
        purpose = agent.get("purpose", "")
        if name in result.project_matched_agents:
            agent_lines.append(f"  - {name}: {purpose} [PROJECT-SPECIFIC]")
        else:
            agent_lines.append(f"  - {name}: {purpose}")
    agent_list = "\n".join(agent_lines)

    # Format skill list with project markers
    skill_parts = []
    for skill in result.matched_skills[:3]:
        if skill in result.project_matched_skills:
            skill_parts.append(f"{skill} [PROJECT]")
        else:
            skill_parts.append(skill)
    skill_list = ", ".join(skill_parts)

    if result.has_project_matches:
        default_template = (
            "Project-configured match. Delegate to one of these subagents:\n"
            "{agent_list}\n\n"
            "Pass these skills to the subagent: {skill_list}\n\n"
            "Append to your Task prompt: \"Use the Skill tool to invoke [skill-name]. Report which skill(s) you used.\"\n\n"
            "Skip delegation only if this is clearly a mismatch or purely informational."
        )
    else:
        default_template = (
            "Delegate to one of these subagents:\n"
            "{agent_list}\n\n"
            "Pass these skills to the subagent: {skill_list}\n\n"
            "Append to your Task prompt: \"Use the Skill tool to invoke [skill-name]. Report which skill(s) you used.\"\n\n"
            "Skip delegation ONLY if this is a purely informational request with no implementation."
        )

    template = template_config.get("template", default_template)
    return template.format(agent_list=agent_list, skill_list=skill_list)


def build_hint(scenario: Scenario, result: MatchResult, rules: Dict[str, Any]) -> str:
    """Build the appropriate hint based on scenario."""
    if scenario == Scenario.SHORT_NO_MATCH:
        return build_short_no_match_hint(rules)
    elif scenario == Scenario.LONG_NO_MATCH:
        return build_long_no_match_hint(rules)
    elif scenario == Scenario.AGENTS_ONLY:
        return build_agents_only_hint(result, rules)
    elif scenario == Scenario.SKILLS_ONLY:
        return build_skills_only_hint(result, rules)
    elif scenario == Scenario.AGENTS_AND_SKILLS:
        return build_agents_and_skills_hint(result, rules)
    else:
        return build_long_no_match_hint(rules)


def build_output(
    result: MatchResult,
    rules: Dict[str, Any],
    config: RouterConfig
) -> Dict[str, Any]:
    """Build the hook output based on match results."""
    scenario = determine_scenario(result, config)
    hint = build_hint(scenario, result, rules)

    log_debug(config, f"Scenario: {scenario.value}, project_matches: {result.has_project_matches}, hint length: {len(hint)} chars")

    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": hint,
        }
    }


# === Main Entry Point ===
def main() -> None:
    """Main entry point for the router hook."""
    start_time = time.time()

    config = load_config()
    log_debug(config, "Router starting")

    try:
        input_data = read_input()
        prompt = input_data.get("prompt", "")
        cwd = input_data.get("cwd", "")

        log_debug(config, f"Received prompt ({len(prompt)} chars, {count_words(prompt)} words)")
        log_debug(config, f"Working directory: {cwd}")

        if not prompt:
            log_debug(config, "Empty prompt, using short_no_match template")
            global_rules, rules_path = load_global_rules(config, cwd)
            if global_rules:
                log_debug(config, f"Loaded global rules from {rules_path}")
                hint = build_short_no_match_hint(global_rules)
                write_output({
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "additionalContext": hint,
                    }
                })
            else:
                write_output({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ""}})
            sys.exit(0)

        # Load and merge rules
        global_rules, rules_path = load_global_rules(config, cwd)
        if global_rules is None or not validate_rules(global_rules):
            log_debug(config, f"Failed to load global rules (searched vendored and plugin locations)")
            write_output({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ""}})
            sys.exit(0)

        log_debug(config, f"Loaded global rules from {rules_path}")

        # Perform structural validation if strict mode is enabled
        if config.strict_validation:
            valid, validation_errors = validate_rules_structure(global_rules)
            if not valid:
                for err in validation_errors:
                    log_debug(config, f"Rules validation warning: {err}")
                # Graceful degradation: log warnings but continue
                # Only fail if the basic validate_rules() already failed

        project_rules = load_project_rules(config, input_data)
        if project_rules:
            log_debug(config, f"Found project rules at {cwd}/{PROJECT_RULES_PATH}")

        merged_rules, project_agents, project_skills = merge_rules(global_rules, project_rules)

        log_debug(
            config,
            f"Loaded rules: {len(merged_rules.get('agent_categories', {}))} categories, "
            f"{len(merged_rules.get('skills', {}))} skills, "
            f"{len(project_agents)} project agents, {len(project_skills)} project skills",
        )

        result = analyze_prompt(prompt, merged_rules, project_agents, project_skills, config)

        log_debug(
            config,
            f"Matches: agents={[a.get('name') for a in result.matched_agents]}, "
            f"skills={result.matched_skills}, "
            f"project_matches={result.has_project_matches}",
        )

        output = build_output(result, merged_rules, config)
        write_output(output)

        elapsed_ms = (time.time() - start_time) * 1000
        log_debug(config, f"Router completed in {elapsed_ms:.1f}ms")

    except Exception as e:
        log_error(f"Unexpected error: {type(e).__name__}: {e}")
        write_output({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ""}})

    sys.exit(0)


if __name__ == "__main__":
    main()
