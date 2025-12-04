#!/bin/bash
# Bundle size check script
# Usage: ./scripts/check-bundle-size.sh [max_size_kb]

set -e

MAX_SIZE_KB=${1:-512}  # Default 512 KB
MAX_SIZE_BYTES=$((MAX_SIZE_KB * 1024))

# Build if dist doesn't exist
if [ ! -d "dist" ]; then
    echo "Building project..."
    npm run build
fi

# Calculate total JS bundle size
TOTAL_SIZE=$(find dist -name "*.js" -exec du -cb {} + 2>/dev/null | tail -1 | cut -f1)

if [ -z "$TOTAL_SIZE" ]; then
    echo "No JS files found in dist/"
    exit 0
fi

TOTAL_SIZE_KB=$((TOTAL_SIZE / 1024))

echo "=================================================="
echo "Bundle Size Report"
echo "=================================================="
echo ""

# Show individual file sizes
echo "Files:"
find dist -name "*.js" -exec du -h {} \; | sort -rh | head -10

echo ""
echo "--------------------------------------------------"
echo "Total: ${TOTAL_SIZE_KB} KB (limit: ${MAX_SIZE_KB} KB)"
echo "--------------------------------------------------"

if [ "$TOTAL_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
    echo ""
    echo "❌ FAILED: Bundle size exceeds ${MAX_SIZE_KB} KB limit"
    echo ""
    echo "Suggestions to reduce bundle size:"
    echo "  1. Use dynamic import() for heavy dependencies"
    echo "     Example: const lib = await import('heavy-lib')"
    echo ""
    echo "  2. Check for duplicate dependencies"
    echo "     Run: npx depcheck"
    echo ""
    echo "  3. Analyze bundle composition"
    echo "     Run: npx vite-bundle-visualizer"
    echo ""
    exit 1
else
    echo ""
    echo "✅ PASSED: Bundle size is within limits"
    exit 0
fi
