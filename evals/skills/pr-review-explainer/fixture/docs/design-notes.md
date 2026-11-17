# Design notes

## Vote tally

The tally approves a change when a simple majority (more than 50 percent) of
the votes approve. Every reviewer's vote counts the same.

## Quota scheduler

The quota scheduler hands each team a weekly review quota and rebalances it on
Monday. It decides which team's queue is served first when two teams are over
quota. It lives in `lib/quota-scheduler.js`.
