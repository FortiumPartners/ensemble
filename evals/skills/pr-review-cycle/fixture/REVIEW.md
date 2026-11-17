# Review Rules

What a reviewer of **shopcart** should care about. Every review reads the copy on the base branch, never the copy on a pull
request's head.

## What every review checks

- Behaviour is proven: a change carries a test, or a reason it cannot.
- Money amounts are integer cents and are computed exactly as documented.
- No secret, token or credential anywhere in the tree.

## Severity

- **Important** — the change is wrong or unsafe: a defect a customer would hit, a wrong amount charged, a secret exposure. An Important finding must be answered before merge.
- **Nit** — a preference that does not change behaviour (naming, wording, formatting). A Nit never blocks a merge.
- **Pre-existing** — a real defect in code this pull request did not introduce. It is reported separately and never blocks this PR.

## Policy

```ensemble-review-policy
{
  "roundCap": 3
}
```
