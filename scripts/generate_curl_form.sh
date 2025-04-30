#!/bin/bash

# File name for prompt content
PROMPT_FILE="prompt.txt"
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

# Save the prompt to a file
echo "$PROMPT" > "$PROMPT_FILE"

# Output curl command
echo ""
echo "✅ Prompt saved to $PROMPT_FILE"
echo ""
echo "👉 Use the following curl command with form data:"
echo ""
echo "curl -X POST $API_URL \\"
echo "  -H \"Content-Type: application/x-www-form-urlencoded\" \\"
echo "  --data-urlencode \"content@$PROMPT_FILE\" \\"
echo "  --data \"shouldDeploy=true\""

# Alternative command with file upload (multipart/form-data)
echo ""
echo "👉 Or use the following curl command with file upload:"
echo ""
echo "curl -X POST $API_URL \\"
echo "  -F \"content=<$PROMPT_FILE\" \\"
echo "  -F \"shouldDeploy=true\"" 