.DEFAULT_GOAL := help
ENGINE := apps/ai-engine

help: ## Tampilkan daftar perintah
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

infra-up: ## Nyalakan Postgres + Redis
	docker compose up -d postgres redis

infra-down: ## Matikan infrastruktur
	docker compose down

install: ## Pasang dependensi ai-engine dan web
	cd $(ENGINE) && python -m venv .venv && .venv/bin/pip install -e ".[dev]"
	npm install

api: ## Jalankan ai-engine (port 8000)
	cd $(ENGINE) && uvicorn api.main:app --reload --port 8000

web: ## Jalankan frontend (port 5173)
	npm run dev:web

test: ## Jalankan test ai-engine
	cd $(ENGINE) && pytest -q

lint: ## Ruff check
	cd $(ENGINE) && ruff check .

fmt: ## Ruff auto-fix
	cd $(ENGINE) && ruff check --fix .

.PHONY: help infra-up infra-down install api web test lint fmt
