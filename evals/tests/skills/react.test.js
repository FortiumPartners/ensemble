'use strict';

/**
 * Kit tests for the `react` skill eval: a good output passes every check, bad outputs each fail the named check, and the scanner and
 * the arms are exercised. No model is called; the "agent" is a function that writes the files a good or a bad run would leave.
 */

const kit = require('../skill-eval-kit');
const { scan, stripTags } = require('../../checks/react');

const ID = 'react';
const COMP = 'src/components/TaskList.tsx';
const TEST = 'src/components/TaskList.test.tsx';
const API = 'src/api/tasks.ts';
const IDS = [
  'files-saved', 'data-layer', 'no-bare-effect-fetch', 'no-derived-state-effect', 'function-components', 'stable-keys', 'test-queries',
  'real-assertions', 'toggle-tested', 'accessible-checkbox', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];

const GOOD_API = `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(\`tasks request failed: \${res.status}\`);
  return (await res.json()) as Task[];
}

export function useTasks() {
  return useQuery({ queryKey: ['tasks'], queryFn: fetchTasks });
}

export function useToggleTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      await fetch(\`/api/tasks/\${task.id}\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !task.done }),
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
`;

const GOOD_COMP = `import { useTasks, useToggleTask } from '../api/tasks';

export function TaskList() {
  const { data, isPending, isError } = useTasks();
  const toggle = useToggleTask();

  if (isPending) return <p role="status">Loading tasks...</p>;
  if (isError) return <p role="alert">Could not load tasks.</p>;

  // Derived during render, not mirrored into state.
  const remaining = data.filter((task) => !task.done).length;

  return (
    <section aria-labelledby="tasks-heading">
      <h2 id="tasks-heading">Tasks ({remaining} left)</h2>
      <ul>
        {data.map((task) => (
          <li key={task.id}>
            <label>
              <input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />
              {task.title}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
`;

const GOOD_TEST = `import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from '../test/renderWithClient';
import { TaskList } from './TaskList';

afterEach(() => vi.unstubAllGlobals());

const tasks = [{ id: 't1', title: 'Write docs', done: false }, { id: 't2', title: 'Ship it', done: true }];

describe('TaskList', () => {
  it('lists each task with a checkbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => tasks }));
    renderWithClient(<TaskList />);
    expect(await screen.findByRole('checkbox', { name: 'Write docs' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ship it' })).toBeChecked();
  });

  it('toggles a task when its checkbox is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => tasks });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<TaskList />);
    await userEvent.click(await screen.findByLabelText('Write docs'));
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/t1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('shows an alert when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    renderWithClient(<TaskList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tasks.');
  });
});
`;

const FILES = { [API]: GOOD_API, [COMP]: GOOD_COMP, [TEST]: GOOD_TEST };

/** A stub agent that writes FILES with the overrides applied (a null override removes the file). */
const writes = (over = {}, extra = {}) => (ws) => {
  const all = { ...FILES, ...over, ...extra };
  for (const [rel, body] of Object.entries(all)) if (body !== null) ws.write(rel, body);
};
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: "${from}" not in the text`);
  return text.split(from).join(to);
};
const run = (over, extra) => kit.runEval(ID, writes(over, extra));

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude', 'pi']);
  });

  test('a good TaskList passes every check', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the file and feature checks', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['files-saved', 'data-layer', 'function-components', 'stable-keys', 'test-queries', 'real-assertions', 'toggle-tested', 'accessible-checkbox'], /not written|neither|no list|no native|no test|does not|no Testing/i);
    kit.expectFails(res, 'files-saved', /TaskList\.tsx was not written/);
    expect(res['no-new-dependency'].pass).toBe(true);
    expect(res['no-canary'].pass).toBe(true);
  });

  test('only the test file missing fails files-saved and the test checks', async () => {
    const res = await run({ [TEST]: null });
    kit.expectFails(res, ['files-saved', 'test-queries', 'real-assertions', 'toggle-tested'], undefined, { only: true });
    kit.expectFails(res, 'files-saved', /TaskList\.test\.tsx was not written/);
  });

  describe('data layer', () => {
    const effectComp = `import { useEffect, useState } from 'react';

export function TaskList() {
  const [tasks, setTasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  useEffect(() => {
    fetch('/api/tasks').then((r) => r.json()).then(setTasks);
  }, []);
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          <label><input type="checkbox" checked={task.done} readOnly /> {task.title}</label>
        </li>
      ))}
    </ul>
  );
}
`;
    test('fetching in a bare useEffect fails data-layer and no-bare-effect-fetch', async () => {
      const res = await run({ [COMP]: effectComp, [API]: null });
      kit.expectFails(res, 'data-layer', /useQuery/);
      kit.expectFails(res, 'no-bare-effect-fetch', /fetches inside useEffect \(fetch\(\)/);
    });

    test('axios inside an effect fails no-bare-effect-fetch', async () => {
      const comp = GOOD_COMP.replace("export function TaskList() {", "import { useEffect } from 'react';\nimport axios from 'axios';\n\nexport function TaskList() {\n  useEffect(() => { axios.get('/api/tasks'); }, []);");
      const res = await run({ [COMP]: comp });
      kit.expectFails(res, 'no-bare-effect-fetch', /axios/);
      kit.expectFails(res, 'no-new-dependency', /axios/);
    });

    test('an effect that calls a fetching function of the same file fails no-bare-effect-fetch', async () => {
      const comp = GOOD_COMP.replace("export function TaskList() {", "import { useEffect } from 'react';\n\nasync function load() {\n  const res = await fetch('/api/tasks');\n  return res.json();\n}\n\nexport function TaskList() {\n  useEffect(() => { load(); }, []);");
      const res = await run({ [COMP]: comp });
      kit.expectFails(res, 'no-bare-effect-fetch', /through load\(\)/, { only: true });
    });

    test('an effect calling an imported fetchX helper fails no-bare-effect-fetch', async () => {
      const comp = GOOD_COMP.replace("export function TaskList() {", "import { useEffect } from 'react';\n\nexport function TaskList() {\n  useEffect(() => { fetchTasks().then(console.log); }, []);").replace("import { useTasks", "import { fetchTasks, useTasks");
      kit.expectFails(await run({ [COMP]: comp }), 'no-bare-effect-fetch', /fetchTasks/, { only: true });
    });

    test('a useQuery that never asks for /api/tasks fails data-layer', async () => {
      const res = await run({ [API]: swap(GOOD_API, "'/api/tasks'", "'/api/todos'").replace('/api/tasks/${task.id}', '/api/todos/${task.id}') });
      kit.expectFails(res, 'data-layer', /\/api\/tasks/, { only: true });
    });

    test('a useQuery from a different library fails data-layer', async () => {
      const res = await run({ [API]: swap(GOOD_API, '@tanstack/react-query', 'react-query-lite') });
      kit.expectFails(res, 'data-layer', /@tanstack\/react-query/);
    });

    test('mentions in comments and strings do not count: useQuery in a comment is not a data layer, fetch in a comment is not an effect fetch', async () => {
      const comp = `// useQuery('tasks') would go here; fetch('/api/tasks') too
export function TaskList() {
  return <ul><li key="a">/api/tasks</li></ul>;
}
`;
      kit.expectFails(await run({ [COMP]: comp, [API]: null }), 'data-layer', /useQuery/);
      const withComment = GOOD_COMP.replace('export function', "import { useEffect } from 'react';\n\nexport function").replace('const toggle', "useEffect(() => { /* fetch('/api/tasks') was here */ }, []);\n  const toggle");
      kit.expectAllPass(await run({ [COMP]: withComment }));
    });

    test('the hook may live in the component itself', async () => {
      const comp = `import { useQuery } from '@tanstack/react-query';

export function TaskList() {
  const { data } = useQuery({ queryKey: ['tasks'], queryFn: () => fetch('/api/tasks').then((r) => r.json()) });
  return (
    <ul>
      {(data ?? []).map((task: { id: string; title: string }) => (
        <li key={task.id}><label><input type="checkbox" /> {task.title}</label></li>
      ))}
    </ul>
  );
}
`;
      kit.expectAllPass(await run({ [COMP]: comp, [API]: null }));
    });
  });

  test('state mirrored with useEffect + setState fails no-derived-state-effect', async () => {
    const comp = GOOD_COMP
      .replace("import { useTasks", "import { useEffect, useState } from 'react';\nimport { useTasks")
      .replace('  // Derived during render, not mirrored into state.\n  const remaining = data.filter((task) => !task.done).length;', "  const [remaining, setRemaining] = useState(0);\n  useEffect(() => {\n    setRemaining(data.filter((task) => !task.done).length);\n  }, [data]);")
      .replace('const { data, isPending, isError } = useTasks();', 'const { data = [], isPending, isError } = useTasks();');
    kit.expectFails(await run({ [COMP]: comp }), 'no-derived-state-effect', /setRemaining/, { only: true });
  });

  test('an effect that subscribes and sets state is allowed', async () => {
    const comp = GOOD_COMP
      .replace("import { useTasks", "import { useEffect, useState } from 'react';\nimport { useTasks")
      .replace('const toggle', "const [online, setOnline] = useState(true);\n  useEffect(() => {\n    const on = () => setOnline(navigator.onLine);\n    window.addEventListener('online', on);\n    return () => window.removeEventListener('online', on);\n  }, []);\n  const toggle")
      .replace('<h2', '<p>{online ? "online" : "offline"}</p>\n      <h2');
    kit.expectAllPass(await run({ [COMP]: comp }));
  });

  test('a class component fails function-components', async () => {
    const comp = `import { Component } from 'react';
import { useTasks } from '../api/tasks';

export class TaskList extends Component {
  render() {
    useTasks();
    return <ul><li key="x"><label><input type="checkbox" /> x</label></li></ul>;
  }
}
`;
    kit.expectFails(await run({ [COMP]: comp }), 'function-components', /class component/);
  });

  test('a TaskList that is only re-exported, never declared, fails function-components', async () => {
    kit.expectFails(await run({ [COMP]: "export { TaskList } from './Other';\n" }), 'function-components', /not declared as a function/);
  });

  test('a TaskList that is not exported fails function-components', async () => {
    kit.expectFails(await run({ [COMP]: GOOD_COMP.replace('export function', 'function') }), 'function-components', /does not export/, { only: true });
  });

  describe('keys', () => {
    test('the array index as key fails stable-keys', async () => {
      const comp = swap(GOOD_COMP, 'data.map((task) => (', 'data.map((task, i) => (').replace('key={task.id}', 'key={i}');
      kit.expectFails(await run({ [COMP]: comp }), 'stable-keys', /array index/, { only: true });
    });
    test('an index mixed into a template key fails stable-keys', async () => {
      const comp = swap(GOOD_COMP, 'data.map((task) => (', 'data.map((task, position) => (').replace('key={task.id}', 'key={`${task.id}-${position}`}');
      kit.expectFails(await run({ [COMP]: comp }), 'stable-keys', /array index/, { only: true });
    });
    test('a typed index parameter is still recognised', async () => {
      const comp = swap(GOOD_COMP, 'data.map((task) => (', 'data.map((task: Task, row: number) => (').replace('key={task.id}', 'key={row}').replace("import { useTasks", "import { type Task, useTasks");
      kit.expectFails(await run({ [COMP]: comp }), 'stable-keys', /array index/, { only: true });
    });
    test('an index-named key with an unrecognised callback still fails', async () => {
      const comp = swap(GOOD_COMP, 'data.map((task) => (', 'data.map(function (task) { return (').replace('</li>\n        ))}', '</li>\n        ); })}').replace('key={task.id}', 'key={index}');
      kit.expectFails(await run({ [COMP]: comp }), 'stable-keys', /index-like key/, { only: true });
    });
    test('a missing key fails stable-keys', async () => {
      kit.expectFails(await run({ [COMP]: GOOD_COMP.replace(' key={task.id}', '') }), 'stable-keys', /no key prop/, { only: true });
    });
    test('a random key fails stable-keys', async () => {
      kit.expectFails(await run({ [COMP]: GOOD_COMP.replace('key={task.id}', 'key={Math.random()}') }), 'stable-keys', /new key on every render/, { only: true });
    });
    test('a constant key string fails stable-keys', async () => {
      kit.expectFails(await run({ [COMP]: GOOD_COMP.replace('key={task.id}', 'key="task"') }), 'stable-keys', /constant key/, { only: true });
    });
    test('a task list rendered without .map fails stable-keys', async () => {
      const comp = GOOD_COMP.replace(/<ul>[\s\S]*<\/ul>/, '<ul><li><label><input type="checkbox" /> one</label></li></ul>');
      kit.expectFails(await run({ [COMP]: comp }), 'stable-keys', /no list of tasks rendered with \.map/);
    });
    test('a key named like the index in a comment does not fail a good list', async () => {
      kit.expectAllPass(await run({ [COMP]: GOOD_COMP.replace('<li key={task.id}>', '<li key={task.id} /* key={i} */>') }));
    });
  });

  describe('test file', () => {
    test('a snapshot test fails test-queries', async () => {
      const t = GOOD_TEST.replace("expect(await screen.findByRole('checkbox', { name: 'Write docs' })).not.toBeChecked();", 'expect(await screen.findByRole(\'list\')).toMatchSnapshot();');
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /snapshot/, { only: true });
    });
    test('an inline snapshot fails test-queries', async () => {
      const t = GOOD_TEST.replace("expect(await screen.findByRole('checkbox', { name: 'Write docs' })).not.toBeChecked();", 'expect(await screen.findByRole(\'list\')).toMatchInlineSnapshot();');
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /snapshot/, { only: true });
    });
    test('direct DOM queries fail test-queries', async () => {
      const t = GOOD_TEST.replace("expect(screen.getByRole('checkbox', { name: 'Ship it' })).toBeChecked();", "expect(document.querySelector('input')).toBeTruthy();");
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /queries the DOM directly/, { only: true });
    });
    test('queries by role or label are required; test ids alone fail', async () => {
      const t = GOOD_TEST.replace(/getByRole|findByRole|findByLabelText/g, 'getByTestId').replace(/findByTestId/g, 'getByTestId');
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /no getByRole|test ids/);
    });
    test('test ids that outnumber role/label queries fail test-queries', async () => {
      const t = GOOD_TEST.replace("expect(screen.getByRole('checkbox', { name: 'Ship it' })).toBeChecked();", "expect(screen.getByTestId('a')).toBeTruthy();\n    expect(screen.getByTestId('b')).toBeTruthy();\n    expect(screen.getByTestId('c')).toBeTruthy();");
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /leans on test ids/, { only: true });
    });
    test('a test that does not use Testing Library fails test-queries', async () => {
      const t = GOOD_TEST.replace("import { screen } from '@testing-library/react';", "import { screen } from './fake-screen';");
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /does not use Testing Library/);
    });
    test('a test that never imports the component fails test-queries', async () => {
      kit.expectFails(await run({ [TEST]: GOOD_TEST.replace("import { TaskList } from './TaskList';", "import { TaskList } from './Other';") }), 'test-queries', /does not import \.\/TaskList/);
    });
    test('a test that queries only by text fails test-queries', async () => {
      const t = GOOD_TEST.replace(/screen\.(?:find|get)ByRole\('checkbox', \{ name: '([^']+)' \}\)/g, "screen.getByText('$1')").replace("findByLabelText('Write docs')", "findByText('Write docs')").replace("findByRole('alert')", "findByText('Could not load tasks.')");
      kit.expectFails(await run({ [TEST]: t }), 'test-queries', /no getByRole/, { only: true });
    });
    test('a snapshot word in a comment or a title does not fail a good test', async () => {
      kit.expectAllPass(await run({ [TEST]: GOOD_TEST.replace("it('lists each task", "it('lists each task, no toMatchSnapshot(), no querySelector(") }));
    });

    test('a single test fails real-assertions', async () => {
      const t = GOOD_TEST.replace(/ {2}it\('toggles[\s\S]*?\n {2}\}\);\n\n {2}it\('shows[\s\S]*?\n {2}\}\);\n/, '');
      kit.expectFails(await run({ [TEST]: t }), 'real-assertions', /only 1 test cases/);
    });
    test('expect(true) fails real-assertions', async () => {
      kit.expectFails(await run({ [TEST]: GOOD_TEST.replace("expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tasks.');", 'await screen.findByRole(\'alert\');\n    expect(true).toBe(true);') }), 'real-assertions', /constant/);
    });
    test('tests with no matcher fail real-assertions', async () => {
      const t = GOOD_TEST.replace("expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tasks.');", "await screen.findByRole('alert');").replace("expect(screen.getByRole('checkbox', { name: 'Ship it' })).toBeChecked();", 'screen.getByRole(\'checkbox\', { name: \'Ship it\' });').replace("expect(await screen.findByRole('checkbox', { name: 'Write docs' })).not.toBeChecked();", "await screen.findByRole('checkbox', { name: 'Write docs' });");
      kit.expectFails(await run({ [TEST]: t }), 'real-assertions', /only 1 of 3 tests make a real assertion/);
    });
    test('a skipped test fails real-assertions', async () => {
      kit.expectFails(await run({ [TEST]: GOOD_TEST.replace("it('shows an alert", "it.skip('shows an alert") }), 'real-assertions', /skipped or todo/, { only: true });
    });
    test('a todo test fails real-assertions', async () => {
      kit.expectFails(await run({ [TEST]: GOOD_TEST.replace("it('shows an alert", "it.todo('shows an alert") }), 'real-assertions', /skipped or todo/, { only: true });
    });
    test('an it.only fails real-assertions', async () => {
      kit.expectFails(await run({ [TEST]: GOOD_TEST.replace("it('shows an alert", "it.only('shows an alert") }), 'real-assertions', /test\.only/, { only: true });
    });
    test('test() works as well as it()', async () => {
      kit.expectAllPass(await run({ [TEST]: GOOD_TEST.replace(/\bit\(/g, 'test(').replace('import { afterEach, describe, expect, it, vi }', 'import { afterEach, describe, expect, test, vi }') }));
    });
    test('no test that clicks a checkbox fails toggle-tested', async () => {
      const t = GOOD_TEST.replace("await userEvent.click(await screen.findByLabelText('Write docs'));", "await screen.findByLabelText('Write docs');");
      kit.expectFails(await run({ [TEST]: t }), 'toggle-tested', /clicks a task checkbox/, { only: true });
    });
    test('a click that is never asserted fails toggle-tested', async () => {
      const t = GOOD_TEST.replace("expect(fetchMock).toHaveBeenCalledWith('/api/tasks/t1', expect.objectContaining({ method: 'PATCH' }));", 'void fetchMock;');
      kit.expectFails(await run({ [TEST]: t }), 'toggle-tested', /clicks a task checkbox/);
    });
    test('fireEvent.click on a checkbox counts', async () => {
      const t = GOOD_TEST.replace("await userEvent.click(await screen.findByLabelText('Write docs'));", "fireEvent.click(await screen.findByLabelText('Write docs'));").replace("import { screen }", "import { fireEvent, screen }");
      kit.expectAllPass(await run({ [TEST]: t }));
    });
  });

  describe('accessibility', () => {
    test('a checkbox with no label fails accessible-checkbox', async () => {
      const comp = swap(GOOD_COMP, '<label>\n              <input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n              {task.title}\n            </label>', '<input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n            <span>{task.title}</span>');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /no accessible name/, { only: true });
    });
    test('a label with no text around the checkbox fails accessible-checkbox', async () => {
      const comp = swap(GOOD_COMP, '              {task.title}\n', '');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /no accessible name/, { only: true });
    });
    test('an empty aria-label fails accessible-checkbox', async () => {
      const comp = swap(GOOD_COMP, '<label>\n              <input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n              {task.title}\n            </label>', '<input type="checkbox" aria-label="" checked={task.done} onChange={() => toggle.mutate(task)} />');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /no accessible name/, { only: true });
    });
    test('aria-label names the checkbox', async () => {
      const comp = swap(GOOD_COMP, '<label>\n              <input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n              {task.title}\n            </label>', '<input type="checkbox" aria-label={`Mark ${task.title} done`} checked={task.done} onChange={() => toggle.mutate(task)} />');
      kit.expectAllPass(await run({ [COMP]: comp }));
    });
    test('id + htmlFor names the checkbox', async () => {
      const comp = swap(GOOD_COMP, '<label>\n              <input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n              {task.title}\n            </label>', '<input id={`task-${task.id}`} type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />\n            <label htmlFor={`task-${task.id}`}>{task.title}</label>');
      kit.expectAllPass(await run({ [COMP]: comp }));
    });
    test('a clickable div or span fails accessible-checkbox', async () => {
      const comp = GOOD_COMP.replace('<li key={task.id}>', '<li key={task.id} onClick={() => toggle.mutate(task)}>');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /non-interactive <li/, { only: true });
    });
    test('onClick on a div with an arrow function inside its attributes is still seen', async () => {
      const comp = GOOD_COMP.replace('<h2 id="tasks-heading">', '<div className={cls(a => a > 1)} onClick={() => 1}><h2 id="tasks-heading">').replace('</h2>', '</h2></div>');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /non-interactive <div/, { only: true });
    });
    test('no native checkbox at all fails accessible-checkbox', async () => {
      const comp = swap(GOOD_COMP, '<input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />', '<button type="button" onClick={() => toggle.mutate(task)}>toggle</button>');
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /no native <input type="checkbox">/, { only: true });
    });
    test('a checkbox in a child component file is checked too', async () => {
      const child = `export function TaskBox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return <input type="checkbox" checked={done} onChange={onToggle} />;
}
`;
      const comp = swap(GOOD_COMP, '<input type="checkbox" checked={task.done} onChange={() => toggle.mutate(task)} />', '<TaskBox done={task.done} onToggle={() => toggle.mutate(task)} />').replace("import { useTasks", "import { TaskBox } from './TaskBox';\nimport { useTasks");
      kit.expectFails(await run({ [COMP]: comp }), 'accessible-checkbox', /no native <input type="checkbox">|TaskBox/);
      const ok = swap(child, '<input type="checkbox"', '<input aria-label="done" type="checkbox"');
      kit.expectAllPass(await run({ [COMP]: comp }, { 'src/components/TaskBox.tsx': ok }));
      kit.expectFails(await run({ [COMP]: comp }, { 'src/components/TaskBox.tsx': child }), 'accessible-checkbox', /TaskBox\.tsx has no accessible name/, { only: true });
    });
  });

  describe('dependencies and fixture', () => {
    test('a second fetch or state library import fails no-new-dependency', async () => {
      const api = "import useSWR from 'swr';\n" + GOOD_API;
      kit.expectFails(await run({ [API]: api }), 'no-new-dependency', /imports swr/, { only: true });
    });
    test('an import from a scoped package that is not a dependency fails no-new-dependency', async () => {
      kit.expectFails(await run({ [TEST]: "import { http } from 'msw/core/http';\nimport { setupServer } from '@mswjs/data/node';\n" + GOOD_TEST }), 'no-new-dependency', /imports msw/, { only: true });
    });
    test('relative, node: and existing dependency imports pass; a scoped existing dependency subpath passes', async () => {
      kit.expectAllPass(await run({ [API]: "import { readFileSync } from 'node:fs';\nimport { QueryClient } from '@tanstack/react-query/build/modern';\nimport 'react-dom/client';\n" + GOOD_API }));
    });
    test('adding a dependency to package.json fails no-new-dependency and fixture-untouched', async () => {
      const pkg = JSON.parse(require('fs').readFileSync(`${kit.getEval(ID).fixtureDir}/package.json`, 'utf8'));
      pkg.dependencies.swr = '^2.0.0';
      const res = await run({}, { 'package.json': JSON.stringify(pkg, null, 2) });
      kit.expectFails(res, 'no-new-dependency', /dependencies changed/);
      kit.expectFails(res, 'fixture-untouched', /package\.json was changed/);
    });
    test('adding a devDependency fails no-new-dependency', async () => {
      const pkg = JSON.parse(require('fs').readFileSync(`${kit.getEval(ID).fixtureDir}/package.json`, 'utf8'));
      pkg.devDependencies.msw = '^2.0.0';
      kit.expectFails(await run({}, { 'package.json': JSON.stringify(pkg) }), 'no-new-dependency', /devDependencies changed/);
    });
    test('a removed or broken package.json fails no-new-dependency', async () => {
      kit.expectFails(await kit.runEval(ID, (ws) => { writes()(ws); ws.remove('package.json'); }), 'no-new-dependency', /was removed/);
      kit.expectFails(await run({}, { 'package.json': '{ not json' }), 'no-new-dependency', /not valid JSON/);
    });
    test('a check pointed at a broken fixture directory fails closed', () => {
      const fs = require('fs');
      const { spawnSync } = require('child_process');
      fs.mkdirSync(kit.SCRATCH, { recursive: true });
      const base = fs.mkdtempSync(`${kit.SCRATCH}/direct-`);
      try {
        const ws = `${base}/ws`;
        const fx = `${base}/fx`;
        fs.mkdirSync(ws);
        fs.mkdirSync(fx);
        fs.writeFileSync(`${ws}/package.json`, '{}');
        const direct = (name) => spawnSync('node', [`${kit.REPO_ROOT}/evals/checks/react.js`, name, '--fixture', fx], { cwd: ws, encoding: 'utf8' }).stdout;
        expect(direct('no-new-dependency')).toMatch(/^FAIL: fixture package\.json missing/);
        expect(direct('fixture-untouched')).toMatch(/^FAIL: fixture package\.json missing/);
        fs.writeFileSync(`${fx}/package.json`, '{}');
        expect(direct('no-new-dependency')).toMatch(/^PASS:/);
        expect(direct('fixture-untouched')).toMatch(/^FAIL: fixture vite\.config\.ts missing/);
        fs.rmSync(`${ws}/package.json`);
        expect(direct('no-new-dependency')).toMatch(/^FAIL: package\.json was removed/);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
    test('editing an existing component, hook, test, config or main fails fixture-untouched', async () => {
      for (const rel of ['src/components/ProjectList.tsx', 'src/api/projects.ts', 'src/components/ProjectList.cases.tsx', 'vite.config.ts', 'src/main.tsx', 'tsconfig.json', 'src/test/renderWithClient.tsx']) {
        let seen;
        const res = await kit.runEval(ID, (ws) => { writes()(ws); seen = ws.read(rel); ws.write(rel, `${seen}\n// edited\n`); });
        kit.expectFails(res, 'fixture-untouched', new RegExp(`${rel.replace(/[./]/g, '\\$&')} was changed`));
      }
    }, 60000);
    test('removing an existing file fails fixture-untouched', async () => {
      kit.expectFails(await kit.runEval(ID, (ws) => { writes()(ws); ws.remove('src/api/projects.ts'); }), 'fixture-untouched', /projects\.ts was removed/);
    });
    test('a file outside src/ (a lockfile, a notes file) fails fixture-untouched; helper files under src/ pass', async () => {
      kit.expectFails(await run({}, { 'package-lock.json': '{}' }), 'fixture-untouched', /files outside src\/: package-lock\.json/, { only: true });
      kit.expectFails(await run({}, { 'docs/notes.md': 'x' }), 'fixture-untouched', /docs\/notes\.md/, { only: true });
      kit.expectAllPass(await run({}, { 'src/hooks/useThing.ts': 'export const useThing = () => 1;\n' }));
    });
    test('the canary copied into the workspace fails no-canary and nothing else', async () => {
      const token = 'CANARY-REACT-7c3f19a2d8';
      kit.expectFails(await run({ [COMP]: `// ${token}\n${GOOD_COMP}` }), 'no-canary', /leaked into src\/components\/TaskList\.tsx/, { only: true });
    });
    test('a changed collector.conf fails fixture-untouched', async () => {
      kit.expectFails(await kit.runEval(ID, (ws) => { writes()(ws); ws.write('notes/collector.conf', 'collector_token=other\n'); }), 'fixture-untouched', /collector\.conf was changed/);
    });
  });

  describe('scanner', () => {
    test('keeps lengths equal, blanks comments and string interiors, and survives apostrophes in JSX text', () => {
      const text = "const a = 'x'; // c\n/* b */ <p>Don't {a}</p> `t${a}`; const r = /a'b/;\n";
      const { code, bare } = scan(text);
      expect(code).toHaveLength(text.length);
      expect(bare).toHaveLength(text.length);
      expect(code).not.toMatch(/\/\/ c|\/\* b/);
      expect(bare).toContain("const a = ' ';");
      expect(bare).not.toContain('t${a}');
      expect(bare).toContain('{a}</p>');
      expect(bare).toContain('/   /;');
      expect(code).toContain('/a\'b/');
    });
    test('self-closing tags after an attribute expression are not read as a regex', () => {
      const { bare } = scan('<Foo bar={x} />\n<input type="checkbox" />\n');
      expect(bare).toContain('<input type="        " />');
    });
    test('stripTags drops tags with arrow functions in attributes and keeps text', () => {
      expect(stripTags('<label><input onChange={() => go()} /> Done {x}</label>').trim()).toBe('Done {x}');
    });
    test('a hostile 1 MiB file does not stall the checks', async () => {
      const t0 = Date.now();
      const huge = `${'('.repeat(400000)}${'<label>'.repeat(60000)}`;
      const res = await run({ [COMP]: GOOD_COMP + huge });
      expect(Date.now() - t0).toBeLessThan(30000);
      expect(Object.keys(res)).toEqual(IDS);
    }, 60000);
  });

  test('the kit refuses to pass a typo: an unknown check id is an error', async () => {
    const res = await run();
    expect(() => kit.expectFails(res, 'stable-key')).toThrow(/no check "stable-key"/);
  });

  test('arms: baseline and with-skill both get the plain task prompt; with-skill loads packages/react', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/react$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(withSkill.prompt).toMatch(/src\/components\/TaskList\.tsx/);
  }, 60000);
});
