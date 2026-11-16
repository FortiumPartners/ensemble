# Review rules

How this repository is reviewed. Keep findings about behaviour, not style.

## Severity

- **Important** A defect that changes behaviour for users or data.
- **Nit** A style or naming remark that changes nothing at run time.
- **Pre-existing** A problem the change did not introduce.

## Repository settings

```ensemble-review-policy
{
  "roundCap": 3,
  "sensitivePaths": ["src/cache/"],
  "highPaths": ["src/session/"]
}
```
