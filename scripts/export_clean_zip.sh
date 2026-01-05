#!/bin/bash
# Clean Zip Export Script for infobase-kb
# Creates a shareable zip without repository bloat
#
# Usage: ./scripts/export_clean_zip.sh
# Output: dist/infobase-kb-clean.zip

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Configuration
OUTPUT_DIR="dist"
ZIP_NAME="infobase-kb-clean.zip"

# Get project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${CYAN}[ZIP] Creating clean export zip...${NC}"
echo "      Project root: $PROJECT_ROOT"

# Create output directory if it doesn't exist
OUTPUT_PATH="$PROJECT_ROOT/$OUTPUT_DIR"
mkdir -p "$OUTPUT_PATH"
echo "      Output directory: $OUTPUT_PATH"

ZIP_PATH="$OUTPUT_PATH/$ZIP_NAME"

# Remove existing zip if present
if [ -f "$ZIP_PATH" ]; then
    rm "$ZIP_PATH"
    echo "      Removed existing zip: $ZIP_PATH"
fi

cd "$PROJECT_ROOT"

echo ""
echo -e "${YELLOW}[ZIP] Creating zip archive...${NC}"

# Create zip with exclusions
# Using zip command with exclude patterns
zip -r "$ZIP_PATH" . \
    -x ".git/*" \
    -x ".git" \
    -x ".cursor/*" \
    -x ".cursor" \
    -x "node_modules/*" \
    -x "node_modules" \
    -x "kb/runs/*" \
    -x "kb/runs" \
    -x "kb/snapshots/*" \
    -x "kb/snapshots" \
    -x "kb/indexes/*" \
    -x "kb/indexes" \
    -x "dist/*" \
    -x "dist" \
    -x "*.log" \
    -x "Thumbs.db" \
    -x ".DS_Store" \
    -x "*/.DS_Store" \
    -x "*/Thumbs.db"

# Get zip file size
if [ -f "$ZIP_PATH" ]; then
    ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
    FILE_COUNT=$(unzip -l "$ZIP_PATH" 2>/dev/null | tail -1 | awk '{print $2}')
    
    echo ""
    echo -e "${GREEN}[OK] Clean zip created successfully!${NC}"
    echo "     Output: $ZIP_PATH"
    echo "     Size: $ZIP_SIZE ($FILE_COUNT files)"
    echo ""
    echo -e "${GRAY}[INFO] Excluded from zip:${NC}"
    echo -e "${GRAY}       - .git/${NC}"
    echo -e "${GRAY}       - .cursor/${NC}"
    echo -e "${GRAY}       - node_modules/${NC}"
    echo -e "${GRAY}       - kb/runs/${NC}"
    echo -e "${GRAY}       - kb/snapshots/${NC}"
    echo -e "${GRAY}       - kb/indexes/${NC}"
    echo -e "${GRAY}       - *.log${NC}"
    echo -e "${GRAY}       - Thumbs.db, .DS_Store${NC}"
else
    echo -e "${RED}[ERROR] Failed to create zip file${NC}"
    exit 1
fi

echo ""
echo -e "${CYAN}Done! Share the zip at: $ZIP_PATH${NC}"
