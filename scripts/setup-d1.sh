#!/bin/bash

# Apply schema to D1 database
echo "Applying schema to D1 database..."
wrangler d1 execute pom_bolt_metadata --file=./schema.sql

echo "D1 database setup complete!" 