#!/usr/bin/env bash

npm i
npx --yes ts-json-schema-generator -p format.ts -t ParticleFile \
    --markdown-description --additional-properties \
    -o schema.json

exit 0
