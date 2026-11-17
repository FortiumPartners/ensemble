.PHONY: check docker
check:
	npm run lint:strict
	npm run test:unit

docker:
	docker build -t ledger-api:local .
