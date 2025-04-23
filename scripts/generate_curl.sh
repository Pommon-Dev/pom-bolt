#!/bin/bash

# File name for JSON payload
OUTPUT_FILE="payload.json"
API_URL="https://persistence-deploy.pom-bolt.pages.dev/api/requirements"

# Large multi-line string (can also be read from a separate .txt or .md file)
read -r -d '' PROMPT << EOM
Create a simple landing page for a coffee shop called \${PROJECT_NAME}. Create detailed components with these requirements:
1. Use 'use client' directive for client-side components
2. Style with Tailwind CSS utility classes for responsive design
3. Use Lucide React for icons (from lucide-react package). Do NOT use other UI libraries unless requested
...
(Testimonial and Development planning sections here — full content as-is)
...
5. Component Architecture:
   - The page is composed of several reusable components: HeroSection, ProductCard, FeatureItem, Testimonial
EOM

# Escape newlines and quotes for JSON
ESCAPED_PROMPT=$(printf "%s" "$PROMPT" | jq -R -s '.')

# Write to a JSON file - add the "content" field which is expected by the API
echo "{ \"content\": $ESCAPED_PROMPT, \"shouldDeploy\": true }" > "$OUTPUT_FILE"

# Output curl command
echo ""
echo "✅ JSON saved to $OUTPUT_FILE"
echo ""
echo "👉 Use the following curl command:"
echo ""
echo "curl -X POST $API_URL \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  --data-binary @$OUTPUT_FILE"

