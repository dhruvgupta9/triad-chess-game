SHELL := /bin/sh

NPM ?= npm
DOCKER ?= docker
IMAGE ?= triad-chess-game
TAG ?= local

.PHONY: help install dev build test typecheck start clean docker-build docker-run deploy

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make install       Install the exact npm lockfile dependencies' \
		'  make dev           Run the client and server development processes' \
		'  make build         Build every workspace' \
		'  make test          Build and run the offline workspace test suites' \
		'  make typecheck     Run every workspace TypeScript check' \
		'  make start         Start the production server and client preview' \
		'  make clean         Remove workspace build output' \
		'  make docker-build  Build the production Docker image' \
		'  make docker-run    Run the image using .env' \
		'  make deploy        Build and push IMAGE:TAG (override both variables)'

install:
	$(NPM) ci

dev:
	$(NPM) run dev

build:
	$(NPM) run build

test:
	$(NPM) test

typecheck:
	$(NPM) run typecheck

start:
	$(NPM) run start

clean:
	$(NPM) run clean

docker-build:
	$(DOCKER) build --tag $(IMAGE):$(TAG) .

docker-run:
	$(DOCKER) run --rm --env-file .env --publish 3001:3001 --publish 5173:5173 $(IMAGE):$(TAG)

deploy:
	$(DOCKER) build --tag $(IMAGE):$(TAG) .
	$(DOCKER) push $(IMAGE):$(TAG)
