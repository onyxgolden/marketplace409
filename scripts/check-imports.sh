#!/bin/bash

echo "Checking forbidden imports..."

# Block alias drift if you ever remove it later
grep -R "@/platform" src && echo "❌ Forbidden alias found" && exit 1

# Block direct Money file imports (architecture rule)
grep -R "Money.js" src && echo "❌ Direct Money file import found" && exit 1

echo "✅ Import rules OK"
