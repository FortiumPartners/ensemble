# tasklog architecture

`src/index.js` parses the command line and calls `src/store.js`, which keeps tasks in a JSON file
(`TASKLOG_FILE`, default `tasks.json`). There are no other modules.
