.PHONY: install lint typecheck test docker-build probe-tms probe-fmcsa dev run tunnel deploy

install:
	cd bridge && npm install

lint:
	cd bridge && npm run lint

typecheck:
	cd bridge && npm run typecheck

test:
	cd bridge && npm run test

docker-build:
	docker build -t inbound-carrier-bridge:local ./bridge

probe-tms:
	cd bridge && npx tsx scripts/tms-probe.ts > ../docs/tms-probe-results.json && cat ../docs/tms-probe-results.json

probe-fmcsa:
	cd bridge && npx tsx scripts/fmcsa-probe.ts && cat ../docs/fmcsa-probe-results.json

dev:
	cd bridge && npm run dev

run:
	cd bridge && npm run start

tunnel:
	ngrok http --url=$$(grep '^NGROK_DOMAIN=' .env | cut -d= -f2-) 8080

deploy:
	./scripts/deploy-cloud-run.sh
