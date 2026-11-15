# shop deploy

Kubernetes manifests for the shop API, kept with kustomize: `base/` is the common part, `overlays/<env>/` one directory per environment.

Clusters (kubectl contexts): `shop-staging` (namespace `shop-staging`) and `shop-prod` (namespace `shop`).
