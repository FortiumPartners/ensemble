# Architecture Quality Rubric

## Purpose

This rubric evaluates the architectural quality of AI-generated code. It measures separation of concerns, dependency management, pattern usage, and detection of anti-patterns. The rubric is designed to be used by judge.js with Claude Opus to provide consistent, reproducible architecture scores.

## Scoring Scale

### Score 1 - Poor

Code has no discernible architecture. Everything is tightly coupled with significant structural problems.

**Separation of Concerns (25%):**
- Monolithic code with no logical boundaries
- Business logic, data access, and presentation mixed together
- Single files/modules doing unrelated tasks
- No clear responsibility assignment to components
- Impossible to identify which code handles which functionality

**Dependency Direction / Layering (25%):**
- Circular dependencies present
- No layering - everything depends on everything
- High-level modules depend on low-level implementation details
- Changes to one component cascade unpredictably
- Import/require statements form a tangled web

**Pattern Usage (25%):**
- No recognizable patterns used
- Code structure appears random/ad-hoc
- No abstraction of common functionality
- Reinventing wheels instead of using established patterns
- Anti-patterns used where patterns would help

**Anti-patterns Detection (25%):**
- God objects/classes present (single class with hundreds of methods)
- Circular dependencies between modules
- Magic numbers and strings throughout
- Tight coupling with no interfaces or abstractions
- Global mutable state used liberally

### Score 2 - Below Average

Code has minimal architecture. Some structure exists but is inconsistent and has significant issues.

**Separation of Concerns (25%):**
- Some separation attempted but inconsistent
- Boundaries exist but are frequently violated
- Some modules handle multiple unrelated concerns
- Partial mixing of layers (e.g., SQL in UI code)
- Responsibilities are unclear in several places

**Dependency Direction / Layering (25%):**
- Some layering present but not enforced
- Several instances of lower layers calling higher layers
- Some circular dependencies or strong coupling
- Dependency flow is mostly one direction with violations
- Abstract interfaces partially used

**Pattern Usage (25%):**
- Some patterns used but applied inconsistently
- Patterns may be misapplied or incomplete
- Mix of ad-hoc code and structured patterns
- Some factory/service patterns but not systematic
- Limited use of dependency injection

**Anti-patterns Detection (25%):**
- Some god objects or large classes (50-100 methods)
- Some circular dependencies
- Several magic values without explanation
- Moderate coupling between unrelated modules
- Some global state that could be localized

### Score 3 - Acceptable (Baseline)

Code has reasonable architecture. Clear structure with some room for improvement.

**Separation of Concerns (25%):**
- Clear separation between major components
- Business logic mostly isolated from data access
- Each module has a primary responsibility
- Occasional boundary violations but generally clean
- Components can be understood independently

**Dependency Direction / Layering (25%):**
- Clear layer structure (e.g., presentation, business, data)
- Dependencies flow in one consistent direction
- No circular dependencies between major components
- High-level policies don't depend on low-level details
- Some use of interfaces to invert dependencies

**Pattern Usage (25%):**
- Appropriate patterns used (Repository, Service, Factory)
- Patterns applied consistently where beneficial
- No over-engineering with unnecessary patterns
- Common functionality abstracted appropriately
- Clear entry points and flow through the system

**Anti-patterns Detection (25%):**
- No god objects (classes reasonably sized)
- No circular dependencies
- Few magic values (most constants named)
- Loose coupling between modules
- No global mutable state in business logic

### Score 4 - Good

Code demonstrates good architectural practices. Clean structure with clear boundaries.

**Separation of Concerns (25%):**
- Excellent separation with clear boundaries
- Each component has single, well-defined responsibility
- Cross-cutting concerns (logging, auth) properly isolated
- Vertical slices or feature modules clearly organized
- Easy to locate code responsible for any feature

**Dependency Direction / Layering (25%):**
- Strict layering with dependency rule enforced
- All dependencies point inward toward core/domain
- Dependency injection used throughout
- Interfaces define boundaries between layers
- External dependencies isolated at edges

**Pattern Usage (25%):**
- Patterns used judiciously and correctly
- Factory, Repository, Service, Strategy patterns as needed
- Domain-Driven Design concepts applied where appropriate
- Event-driven patterns for loose coupling where beneficial
- No over-abstraction - patterns add clear value

**Anti-patterns Detection (25%):**
- No anti-patterns present
- All classes focused and reasonably sized
- Clear, unidirectional dependency flow
- All configuration externalized and named
- State management is explicit and controlled

### Score 5 - Excellent

Code exemplifies architectural best practices. Serves as a reference implementation.

**Separation of Concerns (25%):**
- Perfect separation with clean, obvious boundaries
- Hexagonal/Onion/Clean architecture principles applied
- Business rules completely independent of frameworks
- Infrastructure concerns (DB, HTTP) pluggable
- Each component testable in complete isolation

**Dependency Direction / Layering (25%):**
- Dependency inversion principle fully applied
- Core domain has zero external dependencies
- All dependencies flow inward to stable abstractions
- Plugin architecture for all external concerns
- Boundaries enforced by module/package structure

**Pattern Usage (25%):**
- Masterful pattern selection and application
- Patterns serve the architecture, not vice versa
- CQRS/Event Sourcing where appropriate for complexity
- Mediator/Command patterns for decoupled communication
- Strategic patterns enable future extensibility

**Anti-patterns Detection (25%):**
- Zero anti-patterns
- All SOLID principles demonstrably followed
- Code structure documents intent clearly
- Future changes can be localized to single components
- Architecture supports testing at all levels

## Quality Dimensions Summary

| Dimension | Weight | Key Focus |
|-----------|--------|-----------|
| Separation of Concerns | 25% | Boundaries, responsibilities, isolation |
| Dependency Direction / Layering | 25% | Layer structure, dependency flow, interfaces |
| Pattern Usage | 25% | Appropriate patterns, no over-engineering |
| Anti-patterns Detection | 25% | God objects, circular deps, tight coupling |

## Common Anti-patterns to Detect

### God Object / God Class
- Single class with 20+ methods or 500+ lines
- Class knows too much about too many things
- Changes to any feature require modifying this class

### Circular Dependencies
- Module A imports Module B, Module B imports Module A
- Often indicates unclear boundaries
- Creates fragile, hard-to-test code

### Tight Coupling
- Classes instantiate their dependencies directly
- No interface between components
- Mock/substitute impossible for testing

### Spaghetti Architecture
- No clear flow through the system
- Random calls between any components
- No discernible structure or pattern

### Magic Numbers/Strings
- Hardcoded values with no explanation
- Same magic value repeated in multiple places
- Configuration buried in code

### Global Mutable State
- Shared variables modified from anywhere
- Unpredictable behavior based on call order
- Race conditions waiting to happen

## Evaluation Prompt Template

Use this prompt template when invoking Claude for architecture evaluation:

```
You are an expert software architect evaluating the architectural quality of AI-generated code.

## Task
Evaluate the following code against the Architecture Quality Rubric.

## Code to Evaluate

{code_content}

## Rubric

{rubric_content}

## Instructions

1. First, analyze the code carefully against each dimension in the rubric:
   - Separation of Concerns (25%): Boundaries, responsibilities, isolation
   - Dependency Direction / Layering (25%): Layer structure, dependency flow, interfaces
   - Pattern Usage (25%): Appropriate patterns, no over-engineering
   - Anti-patterns Detection (25%): God objects, circular deps, tight coupling

2. Think through your evaluation step by step (Chain-of-Thought reasoning).

3. Identify specific architectural patterns used (or missing) in the code.

4. List any anti-patterns detected with specific examples.

5. Assign a final score from 1-5 based on the rubric definitions.

## Output Format

Respond in JSON format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence summary of architectural quality>",
  "dimension_scores": {
    "separation_of_concerns": <1-5>,
    "dependency_direction": <1-5>,
    "pattern_usage": <1-5>,
    "anti_patterns": <1-5>
  },
  "patterns_identified": ["<pattern name and where used>", "..."],
  "anti_patterns_found": ["<anti-pattern with specific code example>", "..."],
  "strengths": ["<specific architectural strength>", "..."],
  "weaknesses": ["<specific architectural weakness>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}
```

## Examples

### Example: Score 2 (Below Average)

```python
# app.py - everything in one file
import sqlite3

def get_users():
    conn = sqlite3.connect('app.db')
    cursor = conn.execute('SELECT * FROM users')
    users = []
    for row in cursor:
        user = {'id': row[0], 'name': row[1], 'email': row[2]}
        if user['email'].endswith('@admin.com'):
            user['is_admin'] = True
            user['permissions'] = get_admin_permissions(conn)
        users.append(user)
    conn.close()
    return users

def get_admin_permissions(conn):
    # Business logic mixed with data access
    return ['read', 'write', 'delete']

def render_user_list(users):
    # Presentation mixed into backend
    html = '<ul>'
    for u in users:
        html += f'<li>{u["name"]} - {u["email"]}</li>'
    return html + '</ul>'

def main():
    users = get_users()
    print(render_user_list(users))
```

**Assessment:**
- Separation of Concerns: Everything in one file, layers mixed
- Dependency Direction: No layering, direct database access
- Pattern Usage: No patterns, ad-hoc structure
- Anti-patterns: Magic strings, tight coupling to SQLite

**Score: 2** - Minimal structure, no clear architecture.

### Example: Score 4 (Good)

```python
# domain/user.py
from dataclasses import dataclass
from typing import List

@dataclass
class User:
    id: str
    name: str
    email: str

@dataclass
class AdminUser(User):
    permissions: List[str]

# repositories/user_repository.py
from abc import ABC, abstractmethod
from typing import List, Optional
from domain.user import User

class UserRepository(ABC):
    @abstractmethod
    def get_all(self) -> List[User]:
        pass

    @abstractmethod
    def get_by_id(self, user_id: str) -> Optional[User]:
        pass

# infrastructure/sqlite_user_repository.py
from repositories.user_repository import UserRepository
from domain.user import User

class SQLiteUserRepository(UserRepository):
    def __init__(self, connection_string: str):
        self._conn_string = connection_string

    def get_all(self) -> List[User]:
        # Implementation isolated from domain
        pass

# services/user_service.py
from repositories.user_repository import UserRepository

class UserService:
    def __init__(self, repository: UserRepository):
        self._repository = repository

    def list_users(self):
        return self._repository.get_all()
```

**Assessment:**
- Separation of Concerns: Clear domain, repository, service layers
- Dependency Direction: Dependencies flow inward, interfaces used
- Pattern Usage: Repository pattern, dependency injection
- Anti-patterns: None detected

**Score: 4** - Good architecture with clear boundaries and patterns.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-14 | Initial architecture rubric creation |
