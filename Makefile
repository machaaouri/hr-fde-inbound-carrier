.PHONY: install lint typecheck test docker-build dev run tunnel deploy

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

dev:
	cd bridge && npm run dev

run:
	cd bridge && npm run start

tunnel:
	ngrok http --url=$$(grep '^NGROK_DOMAIN=' .env | cut -d= -f2-) 8080

deploy:
	./scripts/deploy-cloud-run.sh
