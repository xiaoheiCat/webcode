#!/usr/bin/env bash

for dir in */; do
  name=$(echo "${dir%/}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  docker build -t "webcode-$name" "$dir"
done
