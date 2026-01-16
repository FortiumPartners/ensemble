CRITICAL: Let's ensure consistency between our various test cases. Our 3 test scenarios, our tested skills, our project init should all be consistent with one another to reinforce system-level testing:

- We create a new folder structure in our repo
- Populate it with files containing user stories for testing, including language expectations
- init-project discovers the correct stack, which installs the right skills and agents
- We then test with/without those skills
- etc

CRITICAL: I don't see reference to Open Telemtry logs or reviews in the PRD. 

- We SHOULD be capturing this -- review our existing codebase, are we not? If not, highlight this to me as a bug fix (I think Claude code supports this out of the box?)
- If so, we should be enabling and using this as part of analyzing results

F5.3.1 Test Infrastructure

F5.3.2 Local Vendoring Tests

- I don't see anything about creating OR identifying a test repository to use. We need a github repo to use for syncing with Claude on the web
- It's important to test headless claude on the web for multiple reasons:
  - Faster execution
  - Parallel execution
  - Sandboxed environment
  - Is itself a key capability we want to evaluate
- We want to test everything on the web EXCEPT /implement-trd, which we want to test correctly delegates sessions to claude on the web (see below)

F5.3.3 Skills A/B Testing

- Run A and Run B should happen on the web, and should happen in parallel

F5.3.4 Agent Routing Tests

- As our "test case" we should save the prompts and settings that trigger the agent. I want to assess the performance of the prompt using the agent and just running the prompt in the main claude session (again A/B test)

F5.3.5 Command Flow Tests

- Specify running commands locally; note the expectation of remote and parallel in implement-trd particularly -- this is a key requirement
- For the TRD, we want to assess that it documents parallel opportunities and sessions
- 

F5.3.7 Wiggum Mode Bounded Test

- I don't see how this actually tests wiggum mode
- Isn't the wiggum mode promise based on the status file, not <promise>? (verify this)
- This task list is trivial - it will be one-shotted. We need to keep it short, but find a way that almost forces the prompt to come back and fail. Research this one. Note that it is least important - can be a next phase.